import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EXPORTS_BASE_DIR } from '../pipeline/processJob.js';
import type { JobStore } from '../queue/jobStore.js';
import { uploadClipToCloudinary } from './cloudinary.js';
import { refreshYouTubeAccessToken, resolvePublicAppBaseUrl } from './socialOAuth.js';
import type {
  FacebookPageConnection,
  SocialPlatform,
  YouTubeConnection,
} from './socialStore.js';

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export type YouTubePrivacyStatus = 'public' | 'unlisted' | 'private';

export interface PublishResult {
  platform: SocialPlatform;
  externalId: string;
  publishedUrl: string;
  accountLabel: string;
}

function isTrustedUploadHost(rawUrl: string, allowedSuffixes: string[]): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function isPublicHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasCloudinaryConfig(): boolean {
  return Boolean(
    config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret
  );
}

/**
 * Resolves the rendered clip MP4 strictly from the confined EXPORTS_BASE_DIR or the job's
 * trusted Cloudinary videoUrl. Blocks any path traversal or arbitrary URL fetches.
 */
export async function resolveClipMediaForPublish(params: {
  jobId: string;
  clipIndex: number;
  jobStore: JobStore;
}): Promise<{
  localPath: string | null;
  buffer: Buffer;
  publicVideoUrl: string | null;
}> {
  const { jobId, clipIndex, jobStore } = params;
  const filename = `clip-${clipIndex}.mp4`;
  const jobExportDir = path.resolve(EXPORTS_BASE_DIR, jobId);
  const localPath = path.resolve(jobExportDir, filename);

  if (
    !jobExportDir.startsWith(EXPORTS_BASE_DIR + path.sep) ||
    !localPath.startsWith(jobExportDir + path.sep)
  ) {
    throw new Error('Invalid clip export path.');
  }

  // 1. Check local rendered MP4 file on disk
  try {
    const buffer = await fs.readFile(localPath);
    if (buffer.length > 0) {
      const publicBase = resolvePublicAppBaseUrl();
      const candidatePublicUrl = `${publicBase}/api/jobs/${jobId}/clips/${filename}`;
      return {
        localPath,
        buffer,
        publicVideoUrl: isPublicHttpsUrl(candidatePublicUrl) ? candidatePublicUrl : null,
      };
    }
  } catch {
    // Fall through to check stored Cloudinary URL on job record
  }

  // 2. Fallback to trusted Cloudinary HTTPS URL saved on the job record
  const job = await jobStore.get(jobId);
  const clip = job?.clips[clipIndex - 1];
  if (
    clip?.videoUrl &&
    isTrustedUploadHost(clip.videoUrl, ['res.cloudinary.com', 'cloudinary.com'])
  ) {
    const res = await fetch(clip.videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw new Error(`Could not fetch rendered clip from storage (HTTP ${res.status}).`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      localPath: null,
      buffer,
      publicVideoUrl: clip.videoUrl,
    };
  }

  throw new Error(
    'Clip file is no longer available on the server. Generate the clip again and try publishing.'
  );
}

const YOUTUBE_TITLE_LIMIT = 100;
const YOUTUBE_DESCRIPTION_LIMIT = 5000;
const DEFAULT_VIRAL_SHORTS_HASHTAGS =
  '#morningpost #viralvideos #trending #viralposts #viralchallenge #hottrending #viralnow #trendingpost #instatrending #reels #bhojpuri #kpop #sad #funny #motivation #viral #bgmi #anime #kitten #funny #art #viralshorts #humor #viral #love #dance #jokes #quotes #wedding #edit #trending #reels #trendingshorts #youtubeshorts #usa #india #omletarcade #pubgmobile #art #shortvideo #dance #funny #fyp #gaming #humor #jokes #knowledge #love #live #zodiac #xbox #comedy #cute #viralshort #bgmi #news #motivation';

/**
 * Formats YouTube Shorts upload metadata honoring YouTube Studio's exact 100-char title
 * and 5000-char description limits, ensuring viral hashtags and extracting snippet.tags.
 */
export function formatYouTubeUploadMetadata(params: {
  title: string;
  caption: string;
}): { title: string; description: string; tags: string[] } {
  let cleanTitle = params.title.replace(/\s+/g, ' ').trim() || 'ClipGenie Short #Shorts #Viral';
  if (!/#[a-z0-9_]+/i.test(cleanTitle)) {
    const suffix = ' #Shorts #Viral';
    if (cleanTitle.length + suffix.length <= YOUTUBE_TITLE_LIMIT) {
      cleanTitle = `${cleanTitle}${suffix}`;
    } else if (cleanTitle.length + ' #Shorts'.length <= YOUTUBE_TITLE_LIMIT) {
      cleanTitle = `${cleanTitle} #Shorts`;
    }
  }
  cleanTitle = cleanTitle.slice(0, YOUTUBE_TITLE_LIMIT).trim();

  let description = params.caption.trim();
  const hasShortsTag = /#shorts\b/i.test(`${cleanTitle} ${description}`);
  const hasAnyDescHashtag = /#[a-z0-9_]+/i.test(description);

  if (!hasAnyDescHashtag) {
    const spacer = description ? '\n\n' : '';
    if (description.length + spacer.length + DEFAULT_VIRAL_SHORTS_HASHTAGS.length <= YOUTUBE_DESCRIPTION_LIMIT) {
      description = `${description}${spacer}${DEFAULT_VIRAL_SHORTS_HASHTAGS}`;
    }
  } else if (!hasShortsTag) {
    const spacer = description ? ' ' : '';
    if (description.length + spacer.length + '#Shorts'.length <= YOUTUBE_DESCRIPTION_LIMIT) {
      description = `${description}${spacer}#Shorts`;
    }
  }
  description = description.slice(0, YOUTUBE_DESCRIPTION_LIMIT).trim();

  // Extract clean YouTube video tags from hashtags (YouTube allows up to 500 chars total across tags)
  const rawHashtags = `${cleanTitle} ${description}`.match(/#([A-Za-z0-9_]{2,30})/g) ?? [];
  const tags: string[] = [];
  const seen = new Set<string>();
  let totalTagChars = 0;

  for (const raw of rawHashtags) {
    const tag = raw.slice(1);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    if (totalTagChars + tag.length + 1 > 450 || tags.length >= 25) break;
    seen.add(key);
    tags.push(tag);
    totalTagChars += tag.length + 1;
  }

  return { title: cleanTitle, description, tags };
}

/**
 * Publishes a vertical 9:16 MP4 directly to the user's connected YouTube channel as a Short
 * via the YouTube Data API v3 Resumable Upload protocol.
 */
export async function publishToYouTubeShorts(params: {
  connection: YouTubeConnection;
  mp4Buffer: Buffer;
  title: string;
  caption: string;
  privacyStatus: YouTubePrivacyStatus;
}): Promise<PublishResult> {
  const activeConn = await refreshYouTubeAccessToken(params.connection);
  const { title: cleanTitle, description, tags } = formatYouTubeUploadMetadata({
    title: params.title,
    caption: params.caption,
  });

  // Step 1: Initiate resumable upload session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeConn.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(params.mp4Buffer.length),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: cleanTitle,
          description,
          ...(tags.length > 0 ? { tags } : {}),
          categoryId: '22',
        },
        status: {
          privacyStatus: params.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
      signal: AbortSignal.timeout(25_000),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '');
    throw new Error(
      `YouTube upload initialization failed (HTTP ${initRes.status}): ${errText.slice(0, 220)}`
    );
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl || !isTrustedUploadHost(uploadUrl, ['googleapis.com'])) {
    throw new Error('YouTube did not return a valid resumable upload URL.');
  }

  // Step 2: Upload MP4 bytes directly to YouTube
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${activeConn.accessToken}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(params.mp4Buffer.length),
    },
    body: new Uint8Array(params.mp4Buffer),
    signal: AbortSignal.timeout(3 * 60_000),
  });

  const uploaded = (await uploadRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!uploadRes.ok || !uploaded.id) {
    throw new Error(
      uploaded.error?.message || `YouTube video upload failed (HTTP ${uploadRes.status}).`
    );
  }

  logger.info('Published vertical clip to YouTube Shorts', {
    videoId: uploaded.id,
    channelId: activeConn.channelId,
    privacyStatus: params.privacyStatus,
  });

  return {
    platform: 'youtube',
    externalId: uploaded.id,
    publishedUrl: `https://www.youtube.com/shorts/${uploaded.id}`,
    accountLabel: activeConn.channelTitle,
  };
}

/**
 * Publishes a vertical 9:16 MP4 directly to a connected Facebook Page as a Facebook Reel
 * using Meta's official 3-phase binary Reels upload API (works locally without a public URL).
 */
export async function publishToFacebookPageReels(params: {
  page: FacebookPageConnection;
  mp4Buffer: Buffer;
  title: string;
  caption: string;
}): Promise<PublishResult> {
  const { page, mp4Buffer, title, caption } = params;

  // Phase 1: Start Reel upload session
  const startRes = await fetch(`${META_GRAPH_BASE}/${encodeURIComponent(page.pageId)}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      access_token: page.pageAccessToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const startData = (await startRes.json().catch(() => ({}))) as {
    video_id?: string;
    upload_url?: string;
    error?: { message?: string };
  };

  if (!startRes.ok || !startData.video_id || !startData.upload_url) {
    throw new Error(
      startData.error?.message || `Facebook Reels upload start failed (HTTP ${startRes.status}).`
    );
  }

  if (!isTrustedUploadHost(startData.upload_url, ['facebook.com', 'fbcdn.net'])) {
    throw new Error('Facebook returned an unexpected upload endpoint.');
  }

  // Phase 2: Binary upload of the vertical MP4 bytes
  const uploadRes = await fetch(startData.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${page.pageAccessToken}`,
      offset: '0',
      file_size: String(mp4Buffer.length),
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(mp4Buffer),
    signal: AbortSignal.timeout(3 * 60_000),
  });

  const uploadData = (await uploadRes.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { message?: string };
  };

  if (!uploadRes.ok || uploadData.success === false) {
    throw new Error(
      uploadData.error?.message || `Facebook Reels binary upload failed (HTTP ${uploadRes.status}).`
    );
  }

  // Phase 3: Finish & publish Reel to the Facebook Page
  const description = [title.trim(), caption.trim()].filter(Boolean).join('\n\n').slice(0, 2200);
  const finishParams = new URLSearchParams({
    upload_phase: 'finish',
    video_id: startData.video_id,
    video_state: 'PUBLISHED',
    description,
    access_token: page.pageAccessToken,
  });

  const finishRes = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(page.pageId)}/video_reels`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: finishParams.toString(),
      signal: AbortSignal.timeout(30_000),
    }
  );

  const finishData = (await finishRes.json().catch(() => ({}))) as {
    success?: boolean;
    post_id?: string;
    error?: { message?: string };
  };

  if (!finishRes.ok || finishData.success === false) {
    throw new Error(
      finishData.error?.message || `Facebook Reels publish step failed (HTTP ${finishRes.status}).`
    );
  }

  const reelId = finishData.post_id || startData.video_id;
  logger.info('Published vertical clip to Facebook Page Reels', {
    pageId: page.pageId,
    reelId,
  });

  return {
    platform: 'facebook',
    externalId: reelId,
    publishedUrl: `https://www.facebook.com/reel/${startData.video_id}`,
    accountLabel: page.pageName,
  };
}

/**
 * Publishes a vertical 9:16 MP4 directly to a connected Instagram Business/Creator account as a Reel
 * via the Instagram Graph API (container creation -> processing status check -> media_publish).
 */
export async function publishToInstagramReels(params: {
  page: FacebookPageConnection;
  jobId: string;
  clipIndex: number;
  localPath: string | null;
  publicVideoUrl: string | null;
  caption: string;
}): Promise<PublishResult> {
  const { page, jobId, clipIndex, localPath, caption } = params;
  const igAccount = page.instagramAccount;
  if (!igAccount) {
    throw new Error(
      `No Instagram Business or Creator account is linked to Facebook Page "${page.pageName}". Link your Instagram account to this Facebook Page in Meta Business Suite first.`
    );
  }

  let videoUrl = params.publicVideoUrl;
  if (!videoUrl && localPath && hasCloudinaryConfig()) {
    videoUrl = await uploadClipToCloudinary(localPath, jobId, clipIndex - 1);
  }

  if (!videoUrl || !isPublicHttpsUrl(videoUrl)) {
    throw new Error(
      'Instagram Reels API requires a public HTTPS video URL. Add your CLOUDINARY_* keys in .env (or set a public HTTPS APP_URL) so Instagram can fetch the clip.'
    );
  }

  // Step 1: Create Instagram Reel container
  const createParams = new URLSearchParams({
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption.trim().slice(0, 2200),
    share_to_feed: 'true',
    access_token: page.pageAccessToken,
  });

  const createRes = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(igAccount.id)}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createParams.toString(),
      signal: AbortSignal.timeout(30_000),
    }
  );

  const createData = (await createRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!createRes.ok || !createData.id) {
    throw new Error(
      createData.error?.message || `Instagram Reel creation failed (HTTP ${createRes.status}).`
    );
  }

  const creationId = createData.id;

  // Step 2: Poll container status until Instagram finishes ingesting the video (up to ~60s)
  let containerReady = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(creationId)}?fields=status_code,status`,
      {
        headers: { Authorization: `Bearer ${page.pageAccessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );
    const statusData = (await statusRes.json().catch(() => ({}))) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };

    if (statusData.status_code === 'FINISHED' || statusData.status_code === 'PUBLISHED') {
      containerReady = true;
      break;
    }
    if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
      throw new Error(
        statusData.status || 'Instagram rejected the video container during processing.'
      );
    }
  }

  if (!containerReady) {
    throw new Error(
      'Instagram is still processing this video. Please wait a moment and try publishing again.'
    );
  }

  // Step 3: Publish the finished container
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: page.pageAccessToken,
  });

  const publishRes = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(igAccount.id)}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
      signal: AbortSignal.timeout(30_000),
    }
  );

  const publishData = (await publishRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!publishRes.ok || !publishData.id) {
    throw new Error(
      publishData.error?.message || `Instagram Reel publish failed (HTTP ${publishRes.status}).`
    );
  }

  // Step 4: Fetch permalink if available
  let publishedUrl = `https://www.instagram.com/${encodeURIComponent(igAccount.username)}/reels/`;
  try {
    const linkRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(publishData.id)}?fields=permalink`,
      {
        headers: { Authorization: `Bearer ${page.pageAccessToken}` },
        signal: AbortSignal.timeout(10_000),
      }
    );
    const linkData = (await linkRes.json().catch(() => ({}))) as { permalink?: string };
    if (linkData.permalink && /^https:\/\/(www\.)?instagram\.com\//i.test(linkData.permalink)) {
      publishedUrl = linkData.permalink;
    }
  } catch {
    // Fallback to profile reels URL
  }

  logger.info('Published vertical clip to Instagram Reels', {
    igAccountId: igAccount.id,
    mediaId: publishData.id,
  });

  return {
    platform: 'instagram',
    externalId: publishData.id,
    publishedUrl,
    accountLabel: `@${igAccount.username}`,
  };
}
