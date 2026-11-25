import { config } from '../config.js';
import type {
  FacebookPageConnection,
  MetaConnection,
  OAuthProvider,
  YouTubeConnection,
} from './socialStore.js';

const META_GRAPH_VERSION = 'v21.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export function getSocialOAuthConfigStatus(): {
  youtube: boolean;
  meta: boolean;
} {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || config.googleClientId;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || config.googleClientSecret;
  const metaAppId = process.env.META_APP_ID?.trim() || config.metaAppId;
  const metaAppSecret = process.env.META_APP_SECRET?.trim() || config.metaAppSecret;

  return {
    youtube: Boolean(googleClientId && googleClientSecret),
    meta: Boolean(metaAppId && metaAppSecret),
  };
}

/**
 * Resolves the canonical public base URL for OAuth callbacks.
 * Uses APP_URL (required behind proxies/Cloud Run) and falls back to localhost for local dev.
 */
export function resolvePublicAppBaseUrl(requestPortFallback = 3000): string {
  const configured = (process.env.APP_URL?.trim() || config.appUrl).replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return `http://localhost:${requestPortFallback}`;
}

export function getOAuthRedirectUri(provider: OAuthProvider): string {
  const base = resolvePublicAppBaseUrl();
  return `${base}/api/social/oauth/${provider}/callback`;
}

/**
 * Constructs the direct Google OAuth 2.0 authorization URL for YouTube Shorts uploading.
 */
export function buildYouTubeOAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || config.googleClientId;
  if (!clientId) {
    throw new Error(
      'YouTube OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your server .env file.'
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ].join(' '),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Constructs the direct Meta Facebook Login OAuth URL requesting Facebook Page + Instagram Reels permissions.
 */
export function buildMetaOAuthUrl(state: string, redirectUri: string): string {
  const appId = process.env.META_APP_ID?.trim() || config.metaAppId;
  if (!appId) {
    throw new Error(
      'Facebook & Instagram OAuth is not configured yet. Add META_APP_ID and META_APP_SECRET to your server .env file.'
    );
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ].join(','),
    state,
  });

  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Exchanges a Google OAuth authorization code for tokens and fetches the user's YouTube Channel.
 */
export async function exchangeYouTubeOAuthCode(
  code: string,
  redirectUri: string
): Promise<YouTubeConnection> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || config.googleClientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || config.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET on server.');
  }

  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description || tokenData.error || 'Failed to exchange Google OAuth code.'
    );
  }

  // Fetch the authenticated user's YouTube channel metadata
  const channelRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  const channelData = (await channelRes.json().catch(() => ({}))) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
  };

  const firstChannel = channelData.items?.[0];
  if (!firstChannel?.id) {
    throw new Error(
      'No YouTube channel was found on this Google account. Create a YouTube channel first and try connecting again.'
    );
  }

  const expiresInMs = (tokenData.expires_in ?? 3500) * 1000;
  return {
    channelId: firstChannel.id,
    channelTitle: firstChannel.snippet?.title ?? 'YouTube Channel',
    thumbnailUrl: firstChannel.snippet?.thumbnails?.default?.url,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + expiresInMs - 60_000,
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Refreshes an expired Google YouTube access token using its stored refresh token.
 */
export async function refreshYouTubeAccessToken(
  connection: YouTubeConnection
): Promise<YouTubeConnection> {
  if (Date.now() < connection.expiresAt) {
    return connection;
  }
  if (!connection.refreshToken) {
    throw new Error('YouTube session expired. Please reconnect your YouTube account.');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || config.googleClientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || config.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET on server.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: connection.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || 'Could not refresh YouTube token. Please reconnect YouTube.'
    );
  }

  connection.accessToken = data.access_token;
  connection.expiresAt = Date.now() + (data.expires_in ?? 3500) * 1000 - 60_000;
  return connection;
}

/**
 * Exchanges a Meta OAuth code for a long-lived access token and retrieves all managed
 * Facebook Pages along with any linked Instagram Business/Creator accounts.
 */
export async function exchangeMetaOAuthCode(
  code: string,
  redirectUri: string
): Promise<MetaConnection> {
  const appId = process.env.META_APP_ID?.trim() || config.metaAppId;
  const appSecret = process.env.META_APP_SECRET?.trim() || config.metaAppSecret;
  if (!appId || !appSecret) {
    throw new Error('Missing META_APP_ID or META_APP_SECRET on server.');
  }

  const tokenParams = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const shortTokenRes = await fetch(`${META_GRAPH_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const shortData = (await shortTokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };

  if (!shortTokenRes.ok || !shortData.access_token) {
    throw new Error(shortData.error?.message || 'Failed to exchange Meta OAuth authorization code.');
  }

  // Upgrade to a long-lived Meta user token (~60 days)
  let userAccessToken = shortData.access_token;
  let expiresIn = shortData.expires_in ?? 3600;
  try {
    const exchangeParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortData.access_token,
    });
    const longRes = await fetch(`${META_GRAPH_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: exchangeParams.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const longData = (await longRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (longRes.ok && longData.access_token) {
      userAccessToken = longData.access_token;
      expiresIn = longData.expires_in ?? 5_184_000;
    }
  } catch {
    // Keep short-lived token if long-lived exchange is unavailable
  }

  // Fetch Facebook Pages + linked Instagram Business/Creator accounts
  const fields =
    'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';
  const pagesParams = new URLSearchParams({ fields });

  const pagesRes = await fetch(`${META_GRAPH_BASE}/me/accounts?${pagesParams.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const pagesData = (await pagesRes.json().catch(() => ({}))) as {
    data?: Array<{
      id?: string;
      name?: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id?: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
    }>;
    error?: { message?: string };
  };

  if (!pagesRes.ok) {
    throw new Error(pagesData.error?.message || 'Could not load your Facebook Pages from Meta.');
  }

  const pages: FacebookPageConnection[] = (pagesData.data ?? [])
    .filter((p) => Boolean(p.id && p.name && p.access_token))
    .map((p) => ({
      pageId: p.id!,
      pageName: p.name!,
      pictureUrl: p.picture?.data?.url,
      pageAccessToken: p.access_token!,
      instagramAccount: p.instagram_business_account?.id
        ? {
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username ?? 'instagram',
            name: p.instagram_business_account.name,
            profilePictureUrl: p.instagram_business_account.profile_picture_url,
          }
        : undefined,
    }));

  if (pages.length === 0) {
    throw new Error(
      'No Facebook Pages were granted. Select at least one Facebook Page (and its linked Instagram Business/Creator account) during Meta login.'
    );
  }

  // Prefer the first Page that also has a linked Instagram Business/Creator account
  const defaultPage = pages.find((p) => Boolean(p.instagramAccount)) ?? pages[0];

  return {
    userAccessToken,
    expiresAt: Date.now() + expiresIn * 1000 - 60_000,
    pages,
    selectedPageId: defaultPage.pageId,
    facebookEnabled: true,
    instagramEnabled: Boolean(defaultPage.instagramAccount),
    connectedAt: new Date().toISOString(),
  };
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a minimal XSS-safe HTML page for the OAuth popup callback that posts
 * status back to the opener window via postMessage and closes itself.
 */
export function buildOAuthCallbackHtml(params: {
  ok: boolean;
  provider: OAuthProvider;
  errorMessage?: string;
}): string {
  const payload = JSON.stringify({
    type: params.ok ? 'CLIPGENIE_OAUTH_SUCCESS' : 'CLIPGENIE_OAUTH_ERROR',
    provider: params.provider,
    ...(params.errorMessage ? { error: params.errorMessage.slice(0, 240) } : {}),
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const heading = params.ok ? 'Account connected!' : 'Connection could not be completed';
  const bodyText = params.ok
    ? 'You can return to ClipGenie — this window will close automatically.'
    : escapeHtmlText(params.errorMessage || 'Authentication failed. Please try again.');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ClipGenie OAuth</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #09090f; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
      .card { max-width: 420px; background: #12121c; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 28px; }
      h1 { font-size: 18px; margin: 0 0 10px; }
      p { font-size: 14px; color: #a1a1aa; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${heading}</h1>
      <p>${bodyText}</p>
    </div>
    <script>
      (function () {
        var msg = ${payload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(msg, '*');
            window.close();
          }
        } catch (_) {}
      })();
    </script>
  </body>
</html>`;
}
