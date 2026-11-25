import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidJobId,
  parseCanonicalYouTubeUrl,
  sanitizeDownloadSlug,
  validateCreateJobRequest,
  validateSelectedMoments,
} from './validation.js';
import {
  YTDLP_BEST_QUALITY_FORMAT,
  YTDLP_DOWNLOAD_STRATEGIES,
  YTDLP_QUALITY_SORT,
  isValidCookiesBrowser,
  isValidProxyUrl,
  parseSubtitlesToSegments,
} from './services/ytdlp.js';
import {
  HD_TARGET_VIDEO_BITRATE,
  HD_VERTICAL_VIDEO_FILTER,
} from './pipeline/processJob.js';
import {
  buildAssSubtitles,
  buildHighQualityEncodeArgs,
  buildVerticalFilterComplex,
} from './services/ffmpeg.js';
import { InMemoryJobStore } from './queue/jobStore.js';
import { InMemoryClipQueue } from './queue/jobQueue.js';
import {
  buildYouTubeCookieHeaders,
  ensureEnglishCaptionUrl,
  extractBestStreams,
  extractIpFamilyFromGoogleVideoUrl,
  extractStreamCandidates,
  isTrustedGoogleVideoStreamUrl,
  parseBestHlsVariantUrls,
  parseDescriptionChapters,
  parseHlsMaxHeight,
  parseNetscapeCookies,
  parseTimedTextXml,
} from './services/youtubeFetch.js';
import {
  isLikelyNonEnglishTranscript,
  scoreViralHookWindow,
  selectBestMomentsLocally,
  topUpMomentsToCount,
} from './services/momentSelector.js';
import { SocialAccountStore } from './services/socialStore.js';
import {
  buildMetaOAuthUrl,
  buildOAuthCallbackHtml,
  buildYouTubeOAuthUrl,
} from './services/socialOAuth.js';
import { formatYouTubeUploadMetadata } from './services/socialPublish.js';

test('parseTimedTextXml extracts format-3 and legacy YouTube captions cleanly', () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="18640" d="3240">We&#39;re no strangers to love</p><p t="22640" d="4320">You know the rules &amp; so do I</p></body></timedtext>`;
  const segs = parseTimedTextXml(xml);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 18.64);
  assert.equal(segs[0].text, "We're no strangers to love");
  assert.equal(segs[1].text, 'You know the rules & so do I');
});

test('parseDescriptionChapters extracts timestamped chapters from description', () => {
  const desc = 'Intro note\n0:00 Opening Hook\n1:15 Deep Dive Strategy\n03:40 Final Takeaway';
  const chapters = parseDescriptionChapters(desc);
  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters[1], { start: 75, title: 'Deep Dive Strategy' });
});

test('isTrustedGoogleVideoStreamUrl strictly permits HTTPS googlevideo.com hosts', () => {
  assert.equal(
    isTrustedGoogleVideoStreamUrl('https://rr3---sn-a5mlrnzk.googlevideo.com/videoplayback?id=1'),
    true
  );
  assert.equal(isTrustedGoogleVideoStreamUrl('http://rr3.googlevideo.com/video'), false);
  assert.equal(isTrustedGoogleVideoStreamUrl('https://evil-googlevideo.com/video'), false);
  assert.equal(isTrustedGoogleVideoStreamUrl('https://127.0.0.1/video'), false);
});

test('selectBestMomentsLocally picks non-overlapping real-transcript moments with valid lengths', () => {
  const transcript = Array.from({ length: 24 }, (_, idx) => ({
    start: idx * 5,
    end: (idx + 1) * 5,
    text: idx % 4 === 0 ? 'Why do most creators miss this secret hook?' : 'Keep your pacing tight and clear.',
  }));

  const moments = selectBestMomentsLocally({
    transcript,
    chapters: [],
    clipLength: 15,
    clipCount: 3,
    videoDuration: 120,
    videoTitle: 'Creator Growth Masterclass',
    author: 'Studio Lab',
  });

  assert.equal(moments.length, 3);
  for (let i = 0; i < moments.length; i++) {
    const dur = moments[i].end - moments[i].start;
    assert.ok(dur >= 13 && dur <= 17, `Expected 15+/-2s, got ${dur}`);
    for (let j = i + 1; j < moments.length; j++) {
      assert.ok(
        moments[i].end <= moments[j].start || moments[j].end <= moments[i].start,
        'Moments must not overlap'
      );
    }
  }
});

test('parseCanonicalYouTubeUrl canonicalizes valid URLs and rejects SSRF targets', () => {
  const ok = parseCanonicalYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=test');
  assert.equal(ok.valid, true);
  assert.equal(ok.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const shorts = parseCanonicalYouTubeUrl('https://www.youtube.com/shorts/AbCdEf_1234');
  assert.equal(shorts.valid, true);
  assert.equal(shorts.canonicalUrl, 'https://www.youtube.com/watch?v=AbCdEf_1234');

  // Block SSRF, metadata IPs, file://, and arbitrary domains
  assert.equal(parseCanonicalYouTubeUrl('http://169.254.169.254/latest/meta-data/').valid, false);
  assert.equal(parseCanonicalYouTubeUrl('http://localhost:6379/watch?v=dQw4w9WgXcQ').valid, false);
  assert.equal(parseCanonicalYouTubeUrl('file:///etc/passwd').valid, false);
  assert.equal(parseCanonicalYouTubeUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ').valid, false);
});

test('validateCreateJobRequest validates clipLength, clipCount (1-20), captions, videoLayout, and URL', () => {
  const valid = validateCreateJobRequest({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    clipLength: 15,
    clipCount: 10,
    captions: false,
    videoLayout: 'vertical-blur',
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.clipLength, 15);
    assert.equal(valid.data.clipCount, 10);
    assert.equal(valid.data.captions, false);
    assert.equal(valid.data.videoLayout, 'vertical-blur');
  }

  const badLength = validateCreateJobRequest({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    clipLength: 45,
    clipCount: 3,
    captions: true,
  });
  assert.equal(badLength.success, false);

  const badCount = validateCreateJobRequest({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    clipLength: 30,
    clipCount: 25,
    captions: true,
  });
  assert.equal(badCount.success, false);
});

test('isValidJobId strictly accepts UUIDs', () => {
  assert.equal(isValidJobId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidJobId('../etc/passwd'), false);
  assert.equal(isValidJobId('not-a-uuid'), false);
});

test('validateSelectedMoments enforces clipLength +/-2s tolerance and eliminates overlaps', () => {
  const moments = validateSelectedMoments(
    [
      { start: 10, end: 40, title: 'Top Hook', caption: 'Cap 1', score: 95 },
      // Overlaps with Top Hook — must be dropped
      { start: 30, end: 60, title: 'Overlapping', caption: 'Cap 2', score: 90 },
      // Invalid duration (5s) — must be dropped
      { start: 70, end: 75, title: 'Too Short', caption: 'Cap 3', score: 99 },
      // Valid 29s moment (within 30 +/- 2s)
      { start: 100, end: 129, title: 'Strong Insight', caption: 'Cap 4', score: 88 },
    ],
    30,
    3,
    300
  );

  assert.equal(moments.length, 2);
  assert.equal(moments[0].title, 'Top Hook');
  assert.equal(moments[1].title, 'Strong Insight');
});

test('parseSubtitlesToSegments parses VTT and deduplicates adjacent lines', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:03.500 align:start position:0%',
    'Hello <c>world</c>',
    '',
    '00:00:03.500 --> 00:00:05.000',
    'Hello world',
    '',
    '00:00:05.000 --> 00:00:08.250',
    'Second sentence here.',
  ].join('\n');

  const segments = parseSubtitlesToSegments(vtt);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { start: 1, end: 5, text: 'Hello world' });
  assert.deepEqual(segments[1], { start: 5, end: 8.25, text: 'Second sentence here.' });
});

test('buildAssSubtitles emits relative lower-third dialogue lines within clip bounds', () => {
  const ass = buildAssSubtitles(
    [
      { start: 5, end: 9, text: 'Before clip' },
      { start: 10, end: 13.5, text: 'First hook line' },
      { start: 14, end: 18, text: 'Second punchline' },
      { start: 35, end: 40, text: 'After clip' },
    ],
    10,
    25
  );

  assert.ok(ass.includes('PlayResX: 1080'));
  assert.ok(ass.includes('PlayResY: 1920'));
  assert.ok(ass.includes('Dialogue: 0,0:00:00.00,0:00:03.50,LowerThird,,0,0,0,,FIRST HOOK LINE'));
  assert.ok(ass.includes('Dialogue: 0,0:00:04.00,0:00:08.00,LowerThird,,0,0,0,,SECOND PUNCHLINE'));
  assert.ok(!ass.includes('BEFORE CLIP'));
  assert.ok(!ass.includes('AFTER CLIP'));
});

test('InMemoryJobStore and InMemoryClipQueue process queued jobs in order', async () => {
  const store = new InMemoryJobStore();
  const processed: string[] = [];

  const queue = new InMemoryClipQueue(async (jobId) => {
    await store.updateProgress(jobId, { status: 'processing', step: 'Transcribing', progress: 50 });
    processed.push(jobId);
    await store.updateProgress(jobId, { status: 'done', step: 'Done', progress: 100 });
  });

  const jobId = '550e8400-e29b-41d4-a716-446655440000';
  await store.create(jobId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    clipLength: 30,
    clipCount: 3,
    captions: true,
  });

  await queue.enqueue(jobId);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const finished = await store.get(jobId);
  assert.deepEqual(processed, [jobId]);
  assert.equal(finished?.status, 'done');
  assert.equal(finished?.progress, 100);
  await queue.close();
});

test('topUpMomentsToCount tops up 2 AI moments to 5 non-overlapping clips when video duration allows', () => {
  const transcript = Array.from({ length: 42 }, (_, idx) => ({
    start: idx * 5,
    end: (idx + 1) * 5,
    text: `Segment ${idx + 1} delivers a crisp takeaway for viewers.`,
  }));

  const moments = topUpMomentsToCount({
    existing: [
      { start: 18, end: 48, title: 'AI Hook 1', caption: 'Cap 1', score: 96 },
      { start: 60, end: 90, title: 'AI Hook 2', caption: 'Cap 2', score: 93 },
    ],
    transcript,
    chapters: [],
    clipLength: 30,
    clipCount: 5,
    videoDuration: 213,
    videoTitle: 'Full Length Test Video',
    author: 'Test Creator',
  });

  assert.equal(moments.length, 5);
  for (let i = 0; i < moments.length; i++) {
    const dur = moments[i].end - moments[i].start;
    assert.ok(dur >= 28 && dur <= 32, `Expected ~30s clip, got ${dur}s`);
    for (let j = i + 1; j < moments.length; j++) {
      assert.ok(
        moments[i].end <= moments[j].start || moments[j].end <= moments[i].start,
        `Clips ${i} and ${j} must not overlap`
      );
    }
  }
});

test('validateSelectedMoments normalizes slightly off-target durations to clipLength instead of dropping', () => {
  const moments = validateSelectedMoments(
    [
      // 24s moment for clipLength=30 should normalize to 30s (within bounds) instead of being dropped
      { start: 10, end: 34, title: 'Slightly Short AI Clip', caption: 'Cap', score: 91 },
      // 37s moment for clipLength=30 should trim to 30s
      { start: 80, end: 117, title: 'Slightly Long AI Clip', caption: 'Cap 2', score: 89 },
    ],
    30,
    3,
    240
  );

  assert.equal(moments.length, 2);
  assert.equal(moments[0].end - moments[0].start, 30);
  assert.equal(moments[1].end - moments[1].start, 30);
});

test('sanitizeDownloadSlug strips traversal and header injection characters safely', () => {
  assert.equal(sanitizeDownloadSlug('My "Viral"\r\nClip / ../../etc'), 'my-viral-clip-etc');
  assert.equal(sanitizeDownloadSlug('   '), 'clipgenie-short');
  assert.equal(sanitizeDownloadSlug(undefined), 'clipgenie-short');
});

test('parseNetscapeCookies & buildYouTubeCookieHeaders build SAPISIDHASH and filter to YouTube/Google domains', () => {
  const sampleCookies = [
    '# Netscape HTTP Cookie File',
    '.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\ttest_sapisid_value',
    '.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\ttest_sid_value',
    '.evil.com\tTRUE\t/\tTRUE\t1999999999\tSECRET\tshould_not_be_included',
  ].join('\n');

  const parsed = parseNetscapeCookies(sampleCookies);
  assert.equal(parsed.length, 2);
  const headers = buildYouTubeCookieHeaders(sampleCookies);
  assert.ok(headers);
  assert.ok(headers.cookieHeader.includes('SAPISID=test_sapisid_value'));
  assert.ok(!headers.cookieHeader.includes('should_not_be_included'));
  assert.match(headers.authorization ?? '', /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
});

test('isValidProxyUrl accepts only http, https, and socks5 proxy schemes', () => {
  assert.equal(isValidProxyUrl('http://user:pass@proxy.example.com:8080'), true);
  assert.equal(isValidProxyUrl('socks5://127.0.0.1:1080'), true);
  assert.equal(isValidProxyUrl('file:///etc/passwd'), false);
  assert.equal(isValidProxyUrl('not-a-url'), false);
});

test('buildAssSubtitles chunks and wraps long caption lines so they never clip horizontally', () => {
  const ass = buildAssSubtitles(
    [
      { start: 0, end: 1, text: '[Music]' },
      {
        start: 1,
        end: 7,
        text: 'Alright so here we are in front of the elephants and the really cool thing about these guys is their long trunks',
      },
    ],
    0,
    10
  );

  const dialogueLines = ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
  // [Music]-only segment is stripped, long 21-word segment is split into multiple short cues
  assert.ok(dialogueLines.length >= 3, `Expected >=3 short cues, got ${dialogueLines.length}`);
  assert.ok(!ass.includes('[MUSIC]'));
  for (const line of dialogueLines) {
    const textPart = line.split(',,').slice(1).join(',,');
    const visualLines = textPart.split('\\N');
    assert.ok(visualLines.length <= 2, `Cue should wrap into at most 2 lines: ${textPart}`);
    for (const visualLine of visualLines) {
      assert.ok(visualLine.length <= 28, `Wrapped caption line too wide (${visualLine.length}): ${visualLine}`);
    }
  }
});

test('ensureEnglishCaptionUrl appends tlang=en for non-English tracks and preserves English tracks', () => {
  const hindi = ensureEnglishCaptionUrl(
    'https://www.youtube.com/api/timedtext?v=abc12345678&lang=hi',
    'hi'
  );
  assert.ok(hindi);
  assert.equal(new URL(hindi).searchParams.get('tlang'), 'en');

  const english = ensureEnglishCaptionUrl(
    'https://www.youtube.com/api/timedtext?v=abc12345678&lang=en',
    'en'
  );
  assert.ok(english);
  assert.equal(new URL(english).searchParams.get('tlang'), null);

  assert.equal(ensureEnglishCaptionUrl('https://evil.example.com/timedtext?lang=hi', 'hi'), null);
});

test('isLikelyNonEnglishTranscript detects non-Latin scripts vs English accurately', () => {
  assert.equal(
    isLikelyNonEnglishTranscript([
      { start: 0, end: 4, text: 'नमस्ते दोस्तों आज हम एक बड़ा राज़ जानेंगे' },
    ]),
    true
  );
  assert.equal(
    isLikelyNonEnglishTranscript([
      { start: 0, end: 4, text: "Here's why 90% of creators miss this viral hook." },
    ]),
    false
  );
});

test('viral hook scorer ranks a strong hook above generic channel intros and picks the hook first', () => {
  const introScore = scoreViralHookWindow(
    "Hey guys welcome back to my channel, don't forget to subscribe!",
    "Hey guys welcome back to my channel, don't forget to subscribe and hit the bell before we start."
  );
  const hookScore = scoreViralHookWindow(
    "Stop doing this one mistake — here's why 90% of creators fail!",
    "Stop doing this one mistake — here's why 90% of creators fail in their first 3 seconds and how to fix it."
  );
  assert.ok(hookScore > introScore + 15, `Expected hook (${hookScore}) >> intro (${introScore})`);

  const transcript = [
    { start: 0, end: 5, text: 'Hey guys welcome back to my channel.' },
    { start: 5, end: 10, text: "In this video don't forget to subscribe and like." },
    { start: 10, end: 15, text: 'Before we get started check out the link in the description.' },
    { start: 20, end: 25, text: "Stop doing this one mistake — here's why 90% of creators fail!" },
    { start: 25, end: 30, text: 'Nobody talks about the secret retention trick in the first 3 seconds.' },
    { start: 30, end: 35, text: 'Once you switch your opening line, watch time doubles overnight.' },
  ];

  const picked = selectBestMomentsLocally({
    transcript,
    chapters: [],
    clipLength: 15,
    clipCount: 1,
    videoDuration: 40,
    videoTitle: 'Creator Masterclass',
    author: 'Studio Lab',
  });

  assert.equal(picked.length, 1);
  assert.equal(picked[0].start, 20, 'Should pick the viral hook at 20s instead of the 0s channel intro');
});

test('buildVerticalFilterComplex supports Lanczos+unsharp full vertical crop and horizontal-in-9:16 blurred fill', () => {
  const fillFilter = buildVerticalFilterComplex({
    width: 1080,
    height: 1920,
    videoLayout: 'vertical-fill',
    subtitleFilter: ',ass=clip-1.ass',
  });
  assert.ok(
    fillFilter.includes(
      'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int,crop=1080:1920,unsharp=5:5:0.45:3:3:0.0,setsar=1'
    )
  );
  assert.ok(!fillFilter.includes('boxblur'));
  assert.ok(fillFilter.includes(',ass=clip-1.ass'));

  const blurFilter = buildVerticalFilterComplex({
    width: 1080,
    height: 1920,
    videoLayout: 'vertical-blur',
    subtitleFilter: ',ass=clip-1.ass',
  });
  assert.ok(blurFilter.includes('boxblur=20:3[bg]'));
  assert.ok(
    blurFilter.includes(
      'force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.45:3:3:0.0[fg]'
    )
  );
  assert.ok(blurFilter.includes('[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,ass=clip-1.ass[vout]'));

  const explicitPadFilter = buildVerticalFilterComplex({
    width: 1080,
    height: 1920,
    videoLayout: 'vertical-fill',
    subtitleFilter: ',ass=clip-1.ass',
    videoFilter: HD_VERTICAL_VIDEO_FILTER,
  });
  assert.equal(
    explicitPadFilter,
    '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.35:3:3:0.0,setsar=1,ass=clip-1.ass[vout]'
  );
});

test('SocialAccountStore enforces single-use OAuth state, hides tokens in summary, and switches Meta pages', () => {
  const store = new SocialAccountStore();
  const sessionId = store.createSession();
  assert.equal(store.isValidSessionToken(sessionId), true);
  assert.equal(store.isValidSessionToken('invalid-short-token'), false);

  // Single-use CSRF state + provider match
  const state = store.createOAuthState(
    'youtube',
    sessionId,
    'https://example.com/api/social/oauth/youtube/callback'
  );
  // Wrong provider consumes and rejects the state
  assert.equal(store.consumeOAuthState(state, 'meta'), null);
  // Replay attempt fails
  assert.equal(store.consumeOAuthState(state, 'youtube'), null);

  const validState = store.createOAuthState(
    'meta',
    sessionId,
    'https://example.com/api/social/oauth/meta/callback'
  );
  const consumed = store.consumeOAuthState(validState, 'meta');
  assert.ok(consumed);
  assert.equal(consumed.sessionId, sessionId);
  assert.equal(store.consumeOAuthState(validState, 'meta'), null);

  // Store YouTube + Meta tokens and verify public summary never exposes tokens
  store.setYouTubeConnection(sessionId, {
    channelId: 'UC_test_channel',
    channelTitle: 'ClipGenie Studio',
    accessToken: 'secret-yt-access-token',
    refreshToken: 'secret-yt-refresh-token',
    expiresAt: Date.now() + 3600_000,
    connectedAt: new Date().toISOString(),
  });

  store.setMetaConnection(sessionId, {
    userAccessToken: 'secret-meta-user-token',
    expiresAt: Date.now() + 3600_000,
    pages: [
      {
        pageId: 'page_1',
        pageName: 'Main Creator Page',
        pageAccessToken: 'secret-page-token-1',
        instagramAccount: { id: 'ig_1', username: 'creator_main' },
      },
      {
        pageId: 'page_2',
        pageName: 'Second Brand Page',
        pageAccessToken: 'secret-page-token-2',
      },
    ],
    selectedPageId: 'page_1',
    facebookEnabled: true,
    instagramEnabled: true,
    connectedAt: new Date().toISOString(),
  });

  const summary = store.toPublicSummary(sessionId);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('secret-yt-access-token'));
  assert.ok(!serialized.includes('secret-yt-refresh-token'));
  assert.ok(!serialized.includes('secret-meta-user-token'));
  assert.ok(!serialized.includes('secret-page-token-1'));
  assert.equal(summary.youtube?.channelTitle, 'ClipGenie Studio');
  assert.equal(summary.facebook?.pageName, 'Main Creator Page');
  assert.equal(summary.instagram?.username, 'creator_main');

  // Switch active Meta page to page_2 (no linked Instagram account)
  assert.equal(store.selectMetaPage(sessionId, 'page_2'), true);
  assert.equal(store.selectMetaPage(sessionId, 'nonexistent'), false);
  const switched = store.toPublicSummary(sessionId);
  assert.equal(switched.facebook?.pageName, 'Second Brand Page');
  assert.equal(switched.instagram, null);

  // Disconnect platforms cleanly
  store.disconnectPlatform(sessionId, 'youtube');
  store.disconnectPlatform(sessionId, 'facebook');
  const disconnected = store.toPublicSummary(sessionId);
  assert.equal(disconnected.youtube, null);
  assert.equal(disconnected.facebook, null);
  assert.equal(disconnected.metaPages.length, 0);
});

test('buildYouTubeOAuthUrl and buildMetaOAuthUrl build direct provider authorization URLs', () => {
  const prevGoogleId = process.env.GOOGLE_CLIENT_ID;
  const prevMetaId = process.env.META_APP_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.META_APP_ID = 'test-meta-app-id';

  try {
    const ytUrl = new URL(
      buildYouTubeOAuthUrl('state123', 'https://app.example.com/api/social/oauth/youtube/callback')
    );
    assert.equal(ytUrl.origin, 'https://accounts.google.com');
    assert.equal(ytUrl.searchParams.get('client_id'), 'test-google-client-id');
    assert.equal(ytUrl.searchParams.get('state'), 'state123');
    assert.ok(ytUrl.searchParams.get('scope')?.includes('youtube.upload'));

    const metaUrl = new URL(
      buildMetaOAuthUrl('state456', 'https://app.example.com/api/social/oauth/meta/callback')
    );
    assert.equal(metaUrl.origin, 'https://www.facebook.com');
    assert.equal(metaUrl.searchParams.get('client_id'), 'test-meta-app-id');
    assert.equal(metaUrl.searchParams.get('state'), 'state456');
    assert.ok(metaUrl.searchParams.get('scope')?.includes('pages_manage_posts'));
    assert.ok(metaUrl.searchParams.get('scope')?.includes('instagram_content_publish'));
  } finally {
    if (prevGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevGoogleId;
    if (prevMetaId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = prevMetaId;
  }
});

test('buildOAuthCallbackHtml escapes script breakout payloads safely', () => {
  const html = buildOAuthCallbackHtml({
    ok: false,
    provider: 'meta',
    errorMessage: '</script><script>alert(1)</script>',
  });

  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e'));
});

test('formatYouTubeUploadMetadata enforces 100-char title, 5000-char description, viral hashtags, and tags', () => {
  const autoTagged = formatYouTubeUploadMetadata({
    title: 'How Small Teams Ship Faster',
    caption: 'Cut handoffs and keep engineers close to users.',
  });
  assert.ok(autoTagged.title.includes('#Shorts'));
  assert.ok(autoTagged.title.includes('#Viral'));
  assert.ok(autoTagged.title.length <= 100);
  assert.ok(autoTagged.description.includes('#Trending'));
  assert.ok(autoTagged.tags.includes('Shorts'));
  assert.ok(autoTagged.tags.includes('Viral'));

  const longDesc = 'A'.repeat(4950) + ' #Shorts #Viral';
  const maxSized = formatYouTubeUploadMetadata({
    title: 'Exact Custom Title #Shorts #MyTag',
    caption: longDesc,
  });
  assert.equal(maxSized.title, 'Exact Custom Title #Shorts #MyTag');
  assert.equal(maxSized.description.length, longDesc.length);
  assert.ok(maxSized.description.length <= 5000);
  assert.ok(maxSized.tags.includes('MyTag'));
});

test('extractBestStreams and yt-dlp/ffmpeg settings prioritize highest video & clip quality (4K/1080p60 + CRF 17)', () => {
  const picked = extractBestStreams({
    formats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        height: 360,
        bitrate: 500_000,
      },
    ],
    adaptiveFormats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=136',
        mimeType: 'video/mp4; codecs="avc1.4d401f"',
        height: 720,
        fps: 30,
        bitrate: 2_500_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=299',
        mimeType: 'video/mp4; codecs="avc1.64002a"',
        height: 1080,
        fps: 60,
        bitrate: 6_000_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=313',
        mimeType: 'video/webm; codecs="vp9"',
        height: 2160,
        fps: 60,
        bitrate: 18_000_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=251',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 160_000,
      },
    ],
  });

  // Must pick 4K 2160p60 video + highest-bitrate 160k audio instead of 360p muxed or 720p
  assert.equal(picked.videoUrl, 'https://rr1.googlevideo.com/videoplayback?itag=313');
  assert.equal(picked.audioUrl, 'https://rr1.googlevideo.com/videoplayback?itag=251');

  assert.equal(YTDLP_BEST_QUALITY_FORMAT, 'bestvideo+bestaudio/best');
  assert.ok(YTDLP_QUALITY_SORT.startsWith('res,fps,vbr,abr'));
  assert.equal(YTDLP_DOWNLOAD_STRATEGIES[0].name, 'default-hd');
  assert.ok(YTDLP_DOWNLOAD_STRATEGIES[0].format.includes('height>=720'));
  assert.ok(YTDLP_DOWNLOAD_STRATEGIES.some((s) => s.name === 'web_safari-hls-hd'));
  assert.equal(isValidCookiesBrowser('chrome'), true);
  assert.equal(isValidCookiesBrowser('chrome; rm -rf /'), false);

  assert.equal(HD_TARGET_VIDEO_BITRATE, '8000k');
  const encodeArgs = buildHighQualityEncodeArgs(HD_TARGET_VIDEO_BITRATE);
  assert.ok(encodeArgs.includes('-b:v') && encodeArgs[encodeArgs.indexOf('-b:v') + 1] === '8000k');
  assert.ok(encodeArgs.includes('-maxrate') && encodeArgs[encodeArgs.indexOf('-maxrate') + 1] === '12000k');
  assert.ok(encodeArgs.includes('-profile:v') && encodeArgs[encodeArgs.indexOf('-profile:v') + 1] === 'high');
  assert.ok(encodeArgs.includes('-b:a') && encodeArgs[encodeArgs.indexOf('-b:a') + 1] === '192k');
  assert.ok(encodeArgs.includes('-ar') && encodeArgs[encodeArgs.indexOf('-ar') + 1] === '48000');

  // Verify fallback chain includes 4K adaptive -> 1080p MP4 adaptive -> 360p muxed fallback
  const chain = extractStreamCandidates({
    formats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        height: 360,
        bitrate: 500_000,
      },
    ],
    adaptiveFormats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=299',
        mimeType: 'video/mp4; codecs="avc1.64002a"',
        height: 1080,
        fps: 60,
        bitrate: 6_000_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=313',
        mimeType: 'video/webm; codecs="vp9"',
        height: 2160,
        fps: 60,
        bitrate: 18_000_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128_000,
      },
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=251',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 160_000,
      },
    ],
  });
  assert.equal(chain.length, 3);
  assert.equal(chain[0].height, 2160);
  assert.equal(chain[1].height, 1080);
  assert.equal(chain[2].height, 360);
  assert.equal(chain[2].audioUrl, null);
});

test('parseHlsMaxHeight, HLS stream candidate extraction, and IP family detection work accurately', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360',
    'https://manifest.googlevideo.com/360.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
    'https://manifest.googlevideo.com/1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=3840x2160',
    'https://manifest.googlevideo.com/2160.m3u8',
  ].join('\n');

  assert.equal(parseHlsMaxHeight(m3u8), 2160);
  assert.equal(parseHlsMaxHeight('#EXTM3U\n#EXTINF:5.0,\nseg.ts'), 1080);

  const trustedCandidates = extractStreamCandidates({
    hlsManifestUrl: 'https://manifest.googlevideo.com/api/manifest/hls_variant/id/abc/ip/49.36.1.2/file/index.m3u8',
    formats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback?itag=18&ip=49.36.1.2',
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        height: 360,
      },
    ],
  });
  assert.equal(trustedCandidates.length, 2);
  assert.equal(trustedCandidates[0].isHls, true);
  assert.equal(trustedCandidates[0].height, 1080);
  assert.equal(trustedCandidates[1].height, 360);

  // Must reject untrusted non-googlevideo HLS URLs (SSRF protection)
  const untrustedCandidates = extractStreamCandidates({
    hlsManifestUrl: 'https://evil.example.com/manifest.m3u8',
  });
  assert.equal(untrustedCandidates.length, 0);

  // Must detect IPv4 vs IPv6 signed stream bindings from query param or HLS path
  assert.equal(
    extractIpFamilyFromGoogleVideoUrl('https://rr1.googlevideo.com/videoplayback?ip=49.36.12.5'),
    4
  );
  assert.equal(
    extractIpFamilyFromGoogleVideoUrl('https://rr1.googlevideo.com/videoplayback?ip=2405%3A201%3A1%3A%3A2'),
    6
  );
  assert.equal(
    extractIpFamilyFromGoogleVideoUrl('https://manifest.googlevideo.com/api/manifest/hls_variant/ip/49.36.12.5/index.m3u8'),
    4
  );
  assert.equal(
    extractIpFamilyFromGoogleVideoUrl('https://manifest.googlevideo.com/api/manifest/hls_variant/ip/2405%3A201%3A%3A1/index.m3u8'),
    6
  );

  // parseBestHlsVariantUrls must pick the highest-res 1080p/2160p video + matching 234 audio (not 144p)
  const youtubeMasterM3u8 = [
    '#EXTM3U',
    '#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/audio233.m3u8",TYPE=AUDIO,GROUP-ID="233",DEFAULT=YES,AUTOSELECT=YES',
    '#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/audio234.m3u8",TYPE=AUDIO,GROUP-ID="234",DEFAULT=YES,AUTOSELECT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=248000,RESOLUTION=256x144,AUDIO="233"',
    'https://manifest.googlevideo.com/v144.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,AUDIO="234"',
    'https://manifest.googlevideo.com/v1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=18000000,RESOLUTION=3840x2160,AUDIO="234"',
    'https://manifest.googlevideo.com/v2160.m3u8',
  ].join('\n');

  const bestHls = parseBestHlsVariantUrls(
    youtubeMasterM3u8,
    'https://manifest.googlevideo.com/master.m3u8'
  );
  assert.deepEqual(bestHls, {
    videoUrl: 'https://manifest.googlevideo.com/v2160.m3u8',
    audioUrl: 'https://manifest.googlevideo.com/audio234.m3u8',
    height: 2160,
  });

  // Reject untrusted hosts inside HLS playlists
  const evilM3u8 = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
    'https://evil.example.com/v1080.m3u8',
  ].join('\n');
  assert.equal(
    parseBestHlsVariantUrls(evilM3u8, 'https://manifest.googlevideo.com/master.m3u8'),
    null
  );
});








