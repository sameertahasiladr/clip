import crypto from 'node:crypto';

export type OAuthProvider = 'youtube' | 'meta';
export type SocialPlatform = 'youtube' | 'instagram' | 'facebook';

export interface YouTubeConnection {
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  connectedAt: string;
}

export interface InstagramAccountInfo {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
}

export interface FacebookPageConnection {
  pageId: string;
  pageName: string;
  pictureUrl?: string;
  pageAccessToken: string;
  instagramAccount?: InstagramAccountInfo;
}

export interface MetaConnection {
  userAccessToken: string;
  expiresAt: number;
  pages: FacebookPageConnection[];
  selectedPageId: string;
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  connectedAt: string;
}

export interface SocialSessionData {
  sessionId: string;
  youtube?: YouTubeConnection;
  meta?: MetaConnection;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthStateRecord {
  state: string;
  provider: OAuthProvider;
  sessionId: string;
  redirectUri: string;
  expiresAt: number;
}

export interface PublicSocialAccountSummary {
  youtube: {
    connected: true;
    channelId: string;
    channelTitle: string;
    thumbnailUrl?: string;
    connectedAt: string;
  } | null;
  facebook: {
    connected: true;
    pageId: string;
    pageName: string;
    pictureUrl?: string;
    connectedAt: string;
  } | null;
  instagram: {
    connected: true;
    accountId: string;
    username: string;
    name?: string;
    profilePictureUrl?: string;
    linkedPageName: string;
    connectedAt: string;
  } | null;
  metaPages: Array<{
    pageId: string;
    pageName: string;
    pictureUrl?: string;
    hasInstagram: boolean;
    instagramUsername?: string;
  }>;
  selectedMetaPageId: string | null;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TOKEN_REGEX = /^[a-f0-9]{64}$/;

/**
 * Server-side session & OAuth state store keeping provider access/refresh tokens strictly
 * in backend memory (never returned to the browser or written to localStorage).
 */
export class SocialAccountStore {
  private readonly sessions = new Map<string, SocialSessionData>();
  private readonly states = new Map<string, OAuthStateRecord>();

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
    for (const [key, state] of this.states.entries()) {
      if (now > state.expiresAt) {
        this.states.delete(key);
      }
    }
  }

  createSession(): string {
    this.pruneExpired();
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: now,
      updatedAt: now,
    });
    return sessionId;
  }

  isValidSessionToken(token: string | undefined): token is string {
    return typeof token === 'string' && SESSION_TOKEN_REGEX.test(token);
  }

  getSession(sessionId: string): SocialSessionData | null {
    if (!this.isValidSessionToken(sessionId)) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  getOrCreateSession(sessionId?: string): SocialSessionData {
    if (sessionId) {
      const existing = this.getSession(sessionId);
      if (existing) {
        existing.updatedAt = Date.now();
        return existing;
      }
    }
    const freshId = this.createSession();
    return this.sessions.get(freshId)!;
  }

  createOAuthState(provider: OAuthProvider, sessionId: string, redirectUri: string): string {
    this.pruneExpired();
    const state = crypto.randomBytes(24).toString('hex');
    this.states.set(state, {
      state,
      provider,
      sessionId,
      redirectUri,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    });
    return state;
  }

  consumeOAuthState(state: string, expectedProvider: OAuthProvider): OAuthStateRecord | null {
    const record = this.states.get(state);
    if (!record) return null;
    this.states.delete(state); // Single-use CSRF state nonce
    if (Date.now() > record.expiresAt) return null;
    if (record.provider !== expectedProvider) return null;
    return record;
  }

  setYouTubeConnection(sessionId: string, connection: YouTubeConnection): void {
    const session = this.getOrCreateSession(sessionId);
    session.youtube = connection;
    session.updatedAt = Date.now();
  }

  setMetaConnection(sessionId: string, connection: MetaConnection): void {
    const session = this.getOrCreateSession(sessionId);
    session.meta = connection;
    session.updatedAt = Date.now();
  }

  selectMetaPage(sessionId: string, pageId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session?.meta) return false;
    const page = session.meta.pages.find((p) => p.pageId === pageId);
    if (!page) return false;
    session.meta.selectedPageId = page.pageId;
    session.meta.facebookEnabled = true;
    session.meta.instagramEnabled = Boolean(page.instagramAccount);
    session.updatedAt = Date.now();
    return true;
  }

  disconnectPlatform(sessionId: string, platform: SocialPlatform): void {
    const session = this.getSession(sessionId);
    if (!session) return;

    if (platform === 'youtube') {
      delete session.youtube;
    } else if (session.meta) {
      if (platform === 'facebook') {
        session.meta.facebookEnabled = false;
      } else if (platform === 'instagram') {
        session.meta.instagramEnabled = false;
      }
      if (!session.meta.facebookEnabled && !session.meta.instagramEnabled) {
        delete session.meta;
      }
    }
    session.updatedAt = Date.now();
  }

  getSelectedMetaPage(sessionId: string): FacebookPageConnection | null {
    const session = this.getSession(sessionId);
    if (!session?.meta) return null;
    return (
      session.meta.pages.find((p) => p.pageId === session.meta!.selectedPageId) ??
      session.meta.pages[0] ??
      null
    );
  }

  /**
   * Returns a sanitized public summary of connected accounts — NEVER includes access/refresh tokens.
   */
  toPublicSummary(sessionId: string): PublicSocialAccountSummary {
    const session = this.getSession(sessionId);
    const yt = session?.youtube;
    const meta = session?.meta;
    const selectedPage =
      meta?.pages.find((p) => p.pageId === meta.selectedPageId) ?? meta?.pages[0];

    return {
      youtube: yt
        ? {
            connected: true,
            channelId: yt.channelId,
            channelTitle: yt.channelTitle,
            thumbnailUrl: yt.thumbnailUrl,
            connectedAt: yt.connectedAt,
          }
        : null,
      facebook:
        meta && meta.facebookEnabled && selectedPage
          ? {
              connected: true,
              pageId: selectedPage.pageId,
              pageName: selectedPage.pageName,
              pictureUrl: selectedPage.pictureUrl,
              connectedAt: meta.connectedAt,
            }
          : null,
      instagram:
        meta && meta.instagramEnabled && selectedPage?.instagramAccount
          ? {
              connected: true,
              accountId: selectedPage.instagramAccount.id,
              username: selectedPage.instagramAccount.username,
              name: selectedPage.instagramAccount.name,
              profilePictureUrl: selectedPage.instagramAccount.profilePictureUrl,
              linkedPageName: selectedPage.pageName,
              connectedAt: meta.connectedAt,
            }
          : null,
      metaPages:
        meta?.pages.map((p) => ({
          pageId: p.pageId,
          pageName: p.pageName,
          pictureUrl: p.pictureUrl,
          hasInstagram: Boolean(p.instagramAccount),
          instagramUsername: p.instagramAccount?.username,
        })) ?? [],
      selectedMetaPageId: selectedPage?.pageId ?? null,
    };
  }
}

export const socialAccountStore = new SocialAccountStore();
