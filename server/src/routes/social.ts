import express, { type Request } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { AppError } from '../middleware/errorHandler.js';
import type { JobStore } from '../queue/jobStore.js';
import {
  buildMetaOAuthUrl,
  buildOAuthCallbackHtml,
  buildYouTubeOAuthUrl,
  exchangeMetaOAuthCode,
  exchangeYouTubeOAuthCode,
  getOAuthRedirectUri,
  getSocialOAuthConfigStatus,
} from '../services/socialOAuth.js';
import {
  publishToFacebookPageReels,
  publishToInstagramReels,
  publishToYouTubeShorts,
  resolveClipMediaForPublish,
} from '../services/socialPublish.js';
import {
  socialAccountStore,
  type OAuthProvider,
  type SocialPlatform,
} from '../services/socialStore.js';
import { isValidJobId, MAX_CLIP_COUNT } from '../validation.js';

const publishBodySchema = z.object({
  platform: z.enum(['youtube', 'instagram', 'facebook']),
  jobId: z.string().refine(isValidJobId, 'Invalid job ID'),
  clipIndex: z.number().int().min(1).max(MAX_CLIP_COUNT),
  title: z.string().trim().min(1).max(120),
  caption: z.string().trim().max(2200).default(''),
  privacyStatus: z.enum(['public', 'unlisted', 'private']).default('public'),
});

const selectPageBodySchema = z.object({
  pageId: z.string().trim().min(1).max(128),
});

function extractBearerSessionToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (socialAccountStore.isValidSessionToken(token)) {
      return token;
    }
  }
  return undefined;
}

export function createSocialRouter(deps: { jobStore: JobStore }): express.Router {
  const { jobStore } = deps;
  const router = express.Router();

  // Issues or validates an opaque server-verified Bearer session token held in client React memory
  router.post('/session', (req, res) => {
    const existing = extractBearerSessionToken(req);
    const session = socialAccountStore.getOrCreateSession(existing);
    res.json({ sessionToken: session.sessionId });
  });

  // Returns sanitized connection status, Meta pages, and OAuth setup metadata (never returns tokens)
  router.get('/accounts', (req, res) => {
    const token = extractBearerSessionToken(req);
    const session = token ? socialAccountStore.getSession(token) : null;
    const summary = session
      ? socialAccountStore.toPublicSummary(session.sessionId)
      : {
          youtube: null,
          facebook: null,
          instagram: null,
          metaPages: [],
          selectedMetaPageId: null,
        };

    res.json({
      configured: getSocialOAuthConfigStatus(),
      redirectUris: {
        youtube: getOAuthRedirectUri('youtube'),
        meta: getOAuthRedirectUri('meta'),
      },
      ...summary,
    });
  });

  // Builds the direct OAuth provider authorization URL for popup-based OAuth
  router.get('/oauth/:provider/url', (req, res, next) => {
    try {
      const rawProvider = req.params.provider;
      if (rawProvider !== 'youtube' && rawProvider !== 'meta') {
        throw new AppError('Unsupported OAuth provider.', 400, 'INVALID_PROVIDER');
      }
      const provider: OAuthProvider = rawProvider;

      const token = extractBearerSessionToken(req);
      if (!token || !socialAccountStore.getSession(token)) {
        throw new AppError('Active social session required. Refresh and try again.', 401, 'SESSION_REQUIRED');
      }

      const redirectUri = getOAuthRedirectUri(provider);
      const state = socialAccountStore.createOAuthState(provider, token, redirectUri);
      const url =
        provider === 'youtube'
          ? buildYouTubeOAuthUrl(state, redirectUri)
          : buildMetaOAuthUrl(state, redirectUri);

      res.json({ url, redirectUri });
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      next(
        new AppError(
          err instanceof Error ? err.message : 'Unable to initialize OAuth flow.',
          400,
          'OAUTH_NOT_CONFIGURED'
        )
      );
    }
  });

  // OAuth callback handler (supports both /callback and /callback/)
  const handleOAuthCallback = async (req: Request, res: express.Response) => {
    const rawProvider = req.params.provider;
    if (rawProvider !== 'youtube' && rawProvider !== 'meta') {
      res.status(400).type('html').send(
        buildOAuthCallbackHtml({
          ok: false,
          provider: 'youtube',
          errorMessage: 'Unsupported OAuth provider.',
        })
      );
      return;
    }
    const provider: OAuthProvider = rawProvider;

    const oauthError =
      typeof req.query.error_description === 'string'
        ? req.query.error_description
        : typeof req.query.error === 'string'
          ? req.query.error
          : null;

    if (oauthError) {
      res
        .status(200)
        .type('html')
        .send(buildOAuthCallbackHtml({ ok: false, provider, errorMessage: oauthError }));
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    const stateRecord = state ? socialAccountStore.consumeOAuthState(state, provider) : null;
    if (!code || !stateRecord) {
      res.status(400).type('html').send(
        buildOAuthCallbackHtml({
          ok: false,
          provider,
          errorMessage: 'OAuth state expired or invalid. Close this window and click Connect again.',
        })
      );
      return;
    }

    try {
      if (provider === 'youtube') {
        const ytConnection = await exchangeYouTubeOAuthCode(code, stateRecord.redirectUri);
        socialAccountStore.setYouTubeConnection(stateRecord.sessionId, ytConnection);
        logger.info('Connected YouTube channel via OAuth', {
          channelId: ytConnection.channelId,
        });
      } else {
        const metaConnection = await exchangeMetaOAuthCode(code, stateRecord.redirectUri);
        socialAccountStore.setMetaConnection(stateRecord.sessionId, metaConnection);
        logger.info('Connected Meta Facebook Pages & Instagram via OAuth', {
          pageCount: metaConnection.pages.length,
          selectedPageId: metaConnection.selectedPageId,
        });
      }

      res
        .status(200)
        .type('html')
        .send(buildOAuthCallbackHtml({ ok: true, provider }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OAuth token exchange failed.';
      logger.warn('Social OAuth callback failed', { provider, reason: msg });
      res
        .status(200)
        .type('html')
        .send(buildOAuthCallbackHtml({ ok: false, provider, errorMessage: msg }));
    }
  };

  router.get(['/oauth/:provider/callback', '/oauth/:provider/callback/'], (req, res) => {
    void handleOAuthCallback(req, res);
  });

  // Switch active Facebook Page (and its linked Instagram Business account)
  router.post('/meta/select-page', (req, res, next) => {
    try {
      const token = extractBearerSessionToken(req);
      if (!token || !socialAccountStore.getSession(token)) {
        throw new AppError('Connect your Facebook Page first.', 401, 'SESSION_REQUIRED');
      }

      const parsed = selectPageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('A valid pageId is required.', 400, 'VALIDATION_ERROR');
      }

      const ok = socialAccountStore.selectMetaPage(token, parsed.data.pageId);
      if (!ok) {
        throw new AppError('Selected Facebook Page was not found in your account.', 404, 'PAGE_NOT_FOUND');
      }

      res.json({
        configured: getSocialOAuthConfigStatus(),
        redirectUris: {
          youtube: getOAuthRedirectUri('youtube'),
          meta: getOAuthRedirectUri('meta'),
        },
        ...socialAccountStore.toPublicSummary(token),
      });
    } catch (err) {
      next(err);
    }
  });

  // Disconnect a single social platform from the active session
  router.delete('/accounts/:platform', (req, res, next) => {
    try {
      const rawPlatform = req.params.platform;
      if (rawPlatform !== 'youtube' && rawPlatform !== 'instagram' && rawPlatform !== 'facebook') {
        throw new AppError('Unsupported platform.', 400, 'INVALID_PLATFORM');
      }
      const platform: SocialPlatform = rawPlatform;
      const token = extractBearerSessionToken(req);
      if (token) {
        socialAccountStore.disconnectPlatform(token, platform);
      }

      res.json({
        ok: true,
        ...(token
          ? socialAccountStore.toPublicSummary(token)
          : {
              youtube: null,
              facebook: null,
              instagram: null,
              metaPages: [],
              selectedMetaPageId: null,
            }),
      });
    } catch (err) {
      next(err);
    }
  });

  // Directly publishes a rendered 9:16 MP4 clip to YouTube Shorts, Facebook Page Reels, or Instagram Reels
  router.post('/publish', async (req, res, next) => {
    try {
      const token = extractBearerSessionToken(req);
      const session = token ? socialAccountStore.getSession(token) : null;
      if (!session) {
        throw new AppError(
          'Connect your YouTube, Instagram, or Facebook Page account first to publish directly.',
          401,
          'ACCOUNT_NOT_CONNECTED'
        );
      }

      const parsed = publishBodySchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        throw new AppError(
          firstIssue ? `${firstIssue.path.join('.') || 'body'}: ${firstIssue.message}` : 'Invalid publish request.',
          400,
          'VALIDATION_ERROR'
        );
      }

      const { platform, jobId, clipIndex, title, caption, privacyStatus } = parsed.data;

      // Verify target platform is connected BEFORE reading media
      if (platform === 'youtube' && !session.youtube) {
        throw new AppError('Connect your YouTube channel first to publish Shorts.', 401, 'YOUTUBE_NOT_CONNECTED');
      }
      const selectedMetaPage = socialAccountStore.getSelectedMetaPage(session.sessionId);
      if (platform === 'facebook' && (!session.meta?.facebookEnabled || !selectedMetaPage)) {
        throw new AppError('Connect your Facebook Page first to publish Reels.', 401, 'FACEBOOK_NOT_CONNECTED');
      }
      if (
        platform === 'instagram' &&
        (!session.meta?.instagramEnabled || !selectedMetaPage?.instagramAccount)
      ) {
        throw new AppError(
          'Connect a Facebook Page linked to an Instagram Business/Creator account first.',
          401,
          'INSTAGRAM_NOT_CONNECTED'
        );
      }

      const media = await resolveClipMediaForPublish({ jobId, clipIndex, jobStore });

      let result;
      if (platform === 'youtube') {
        result = await publishToYouTubeShorts({
          connection: session.youtube!,
          mp4Buffer: media.buffer,
          title,
          caption,
          privacyStatus,
        });
      } else if (platform === 'facebook') {
        result = await publishToFacebookPageReels({
          page: selectedMetaPage!,
          mp4Buffer: media.buffer,
          title,
          caption,
        });
      } else {
        result = await publishToInstagramReels({
          page: selectedMetaPage!,
          jobId,
          clipIndex,
          localPath: media.localPath,
          publicVideoUrl: media.publicVideoUrl,
          caption,
        });
      }

      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      next(
        new AppError(
          err instanceof Error ? err.message : 'Failed to publish clip to social platform.',
          502,
          'PUBLISH_FAILED'
        )
      );
    }
  });

  return router;
}
