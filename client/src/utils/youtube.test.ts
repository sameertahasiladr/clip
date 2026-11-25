import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  getViralityLabel,
  sanitizeFilename,
  validateYouTubeUrl,
} from './youtube';
import { buildMockClips } from '../api';
import {
  YOUTUBE_DESCRIPTION_MAX_CHARS,
  YOUTUBE_TITLE_MAX_CHARS,
  appendHashtagSafely,
  buildDefaultYouTubeDescription,
  buildDefaultYouTubeTitle,
  suggestViralHashtags,
} from './youtubeMetadata';

test('validateYouTubeUrl accepts watch, youtu.be, and shorts formats', () => {
  const watch = validateYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  assert.equal(watch.valid, true);
  assert.equal(watch.videoId, 'dQw4w9WgXcQ');
  assert.equal(watch.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const shortLink = validateYouTubeUrl('https://youtu.be/abcDEF_1234');
  assert.equal(shortLink.valid, true);
  assert.equal(shortLink.videoId, 'abcDEF_1234');

  const shorts = validateYouTubeUrl('https://youtube.com/shorts/xyz123-_ABC?feature=share');
  assert.equal(shorts.valid, true);
  assert.equal(shorts.videoId, 'xyz123-_ABC');

  const withoutProtocol = validateYouTubeUrl('youtu.be/dQw4w9WgXcQ');
  assert.equal(withoutProtocol.valid, true);
});

test('validateYouTubeUrl rejects empty, non-YouTube, unsafe schemes, and malformed IDs', () => {
  assert.equal(validateYouTubeUrl('').valid, false);
  assert.equal(validateYouTubeUrl('https://vimeo.com/123456789').valid, false);
  assert.equal(validateYouTubeUrl('javascript:alert(1)').valid, false);
  assert.equal(validateYouTubeUrl('http://127.0.0.1/watch?v=dQw4w9WgXcQ').valid, false);
  assert.equal(validateYouTubeUrl('https://www.youtube.com/watch?v=short').valid, false);
  assert.equal(validateYouTubeUrl('https://www.youtube.com/channel/UC12345').valid, false);
});

test('formatDuration, getViralityLabel, and sanitizeFilename format predictably', () => {
  assert.equal(formatDuration(30), '0:30');
  assert.equal(formatDuration(15), '0:15');
  assert.equal(formatDuration(95), '1:35');

  assert.equal(getViralityLabel(95).label, 'High Hook');
  assert.equal(getViralityLabel(84).label, 'Strong');
  assert.equal(getViralityLabel(72).label, 'Solid');

  assert.equal(sanitizeFilename('Why 90% of Viral Hooks Win!'), 'why-90-of-viral-hooks-win');
  assert.equal(sanitizeFilename('   '), 'clipgenie-short');
});

test('buildMockClips respects clipCount, clipLength tolerance, and captions toggle', () => {
  const clips3 = buildMockClips('job-1', 30, 3, true);
  assert.equal(clips3.length, 3);
  assert.equal(clips3[0].captionsEnabled, true);
  for (const clip of clips3) {
    assert.ok(clip.duration >= 28 && clip.duration <= 32);
    assert.ok(clip.score >= 0 && clip.score <= 100);
    assert.ok(clip.videoUrl.startsWith('/samples/clip-'));
  }

  const clips5 = buildMockClips('job-2', 15, 5, false);
  assert.equal(clips5.length, 5);
  assert.equal(clips5[0].captionsEnabled, false);
  for (const clip of clips5) {
    assert.ok(clip.duration >= 13 && clip.duration <= 17);
  }
});

test('buildDefaultYouTubeTitle includes #Shorts and #Viral within 100 chars even for long titles', () => {
  const shortTitle = buildDefaultYouTubeTitle('Why 90% of Viral Hooks Win in Two Seconds');
  assert.ok(shortTitle.includes('#Shorts'));
  assert.ok(shortTitle.includes('#Viral'));
  assert.ok(shortTitle.length <= YOUTUBE_TITLE_MAX_CHARS);

  const veryLongTitle = buildDefaultYouTubeTitle(
    'This is an extraordinarily long YouTube video clip title that definitely exceeds one hundred characters by itself and must be trimmed cleanly'
  );
  assert.ok(veryLongTitle.includes('#Shorts'));
  assert.ok(veryLongTitle.includes('#Viral'));
  assert.ok(veryLongTitle.length <= YOUTUBE_TITLE_MAX_CHARS);
});

test('buildDefaultYouTubeDescription includes viral hashtags and respects 5000 char limit', () => {
  const desc = buildDefaultYouTubeDescription(
    'Creator Growth Strategy',
    'Start inside the tension and double your retention overnight. #creatorstrategy'
  );
  assert.ok(desc.includes('#Shorts'));
  assert.ok(desc.includes('#Viral'));
  assert.ok(desc.includes('#Trending'));
  assert.ok(desc.includes('#YouTubeShorts'));
  assert.ok(desc.length <= YOUTUBE_DESCRIPTION_MAX_CHARS);

  // Appending an already-present hashtag does not duplicate it
  const same = appendHashtagSafely(desc, '#Viral', YOUTUBE_DESCRIPTION_MAX_CHARS, '\n');
  assert.equal(same, desc);
});

test('suggestViralHashtags recommends context-matched niche, topic, and viral hashtags', () => {
  const aiResult = suggestViralHashtags({
    title: 'How AI Coding Agents Automate Python Workflows',
    caption: 'Build faster developer pipelines with OpenAI and automation.',
    transcriptCues: [{ text: 'THIS CODING TOOL SAVES DEVELOPERS HOURS' }],
  });
  assert.equal(aiResult.detectedNiche, 'AI & Tech');
  assert.ok(aiResult.titleHashtags.includes('#Shorts'));
  assert.ok(aiResult.titleHashtags.includes('#Viral'));
  assert.ok(aiResult.nicheHashtags.includes('#TechShorts'));
  assert.ok(aiResult.allDescriptionHashtags.includes('#Trending'));
  assert.ok(aiResult.allDescriptionHashtags.includes('#TechShorts'));

  const fitnessResult = suggestViralHashtags({
    title: '30-Second Gym Workout Tip for Faster Muscle Growth',
    caption: 'Improve your strength training and protein intake.',
  });
  assert.equal(fitnessResult.detectedNiche, 'Fitness & Health');
  assert.ok(fitnessResult.nicheHashtags.includes('#FitnessShorts'));
  assert.ok(fitnessResult.allDescriptionHashtags.includes('#WorkoutTips'));
});


