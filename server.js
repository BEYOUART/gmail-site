'use strict';

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');

const requiredEnvVars = [
  'APP_PASSWORD',
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI'
];

const missingVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingVars.length > 0) {
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const {
  APP_PASSWORD,
  SESSION_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
} = process.env;

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: 'gmail_site_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_REDIRECT_URI
    },
    (accessToken, refreshToken, profile, done) => {
      done(null, {
        id: profile.id,
        displayName: profile.displayName,
        emails: profile.emails || [],
        accessToken,
        refreshToken: refreshToken || null
      });
    }
  )
);

app.use(express.static('public'));

function requireUnlocked(req, res, next) {
  if (!req.session || !req.session.isUnlocked) {
    return res.status(401).json({ error: 'Site is locked. Enter password first.' });
  }
  next();
}

function requireGoogleAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Google account is not connected.' });
  }

  if (!req.user || !req.user.accessToken) {
    return res.status(401).json({ error: 'Google token is missing. Reconnect Gmail.' });
  }

  next();
}

function requireMailAccess(req, res, next) {
  return requireUnlocked(req, res, (unlockErr) => {
    if (unlockErr) return next(unlockErr);
    return requireGoogleAuth(req, res, next);
  });
}

function getGmailClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken || undefined
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function headerValue(headers, name) {
  const entry = headers.find((h) => h.name && h.name.toLowerCase() === name.toLowerCase());
  return entry ? entry.value : '';
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function ensureValidMessageId(messageId) {
  return typeof messageId === 'string' && /^[a-zA-Z0-9_-]{10,}$/.test(messageId);
}

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/unlock', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  req.session.isUnlocked = true;
  return res.json({ ok: true, message: 'Site unlocked.' });
});

app.post('/api/lock', (req, res) => {
  if (req.session) {
    req.session.isUnlocked = false;
  }

  req.logout(() => {
    res.json({ ok: true, message: 'Locked and disconnected.' });
  });
});

app.get('/api/session', (req, res) => {
  const connectedEmail = req.user?.emails?.[0]?.value || null;
  res.json({
    unlocked: Boolean(req.session && req.session.isUnlocked),
    gmailConnected: Boolean(req.isAuthenticated && req.isAuthenticated()),
    connectedEmail
  });
});

app.get('/auth/google', requireUnlocked, passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.modify'],
  accessType: 'offline',
  prompt: 'consent'
}));

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/?error=google_auth_failed',
    session: true
  }),
  (req, res) => {
    res.redirect('/');
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out from Google session.' });
    }

    res.json({ ok: true });
  });
});

app.get('/api/inbox', requireMailAccess, async (req, res) => {
  try {
    const gmail = getGmailClient(req.user);
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      labelIds: ['INBOX']
    });

    const messages = listResponse.data.messages || [];

    const detailedMessages = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });

        const payload = detail.data.payload || { headers: [] };
        const headers = payload.headers || [];

        return {
          id: detail.data.id,
          threadId: detail.data.threadId,
          from: headerValue(headers, 'From') || '(Unknown sender)',
          subject: headerValue(headers, 'Subject') || '(No subject)',
          date: headerValue(headers, 'Date') || '',
          snippet: detail.data.snippet || ''
        };
      })
    );

    return res.json({ messages: detailedMessages });
  } catch (error) {
    console.error('Gmail inbox error:', error?.response?.data || error.message);
    return res.status(502).json({
      error: 'Could not fetch inbox from Gmail. Please reconnect and try again.'
    });
  }
});

app.get('/api/messages/:id', requireMailAccess, async (req, res) => {
  const messageId = req.params.id;

  if (!ensureValidMessageId(messageId)) {
    return res.status(400).json({ error: 'Invalid message ID.' });
  }

  try {
    const gmail = getGmailClient(req.user);
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const payload = detail.data.payload || {};
    const headers = payload.headers || [];

    let bodyText = '';

    if (payload.body && payload.body.data) {
      bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts && Array.isArray(payload.parts)) {
      const textPart = payload.parts.find((part) => part.mimeType === 'text/plain' && part.body?.data);
      const htmlPart = payload.parts.find((part) => part.mimeType === 'text/html' && part.body?.data);
      const selectedPart = textPart || htmlPart;

      if (selectedPart?.body?.data) {
        bodyText = Buffer.from(selectedPart.body.data, 'base64').toString('utf-8');
      }
    }

    return res.json({
      id: detail.data.id,
      threadId: detail.data.threadId,
      from: headerValue(headers, 'From') || '',
      to: headerValue(headers, 'To') || '',
      subject: headerValue(headers, 'Subject') || '(No subject)',
      date: headerValue(headers, 'Date') || '',
      snippet: detail.data.snippet || '',
      body: bodyText || '(No readable plain-text body found.)'
    });
  } catch (error) {
    console.error('Gmail message detail error:', error?.response?.data || error.message);
    return res.status(502).json({ error: 'Could not fetch this message from Gmail.' });
  }
});

app.post('/api/send', requireMailAccess, async (req, res) => {
  const to = (req.body.to || '').trim();
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();

  if (!to || !subject || !message) {
    return res.status(400).json({ error: 'To, subject, and message are required.' });
  }

  try {
    const gmail = getGmailClient(req.user);

    const rfc2822 = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      message
    ].join('\r\n');

    const raw = base64UrlEncode(rfc2822);

    const sent = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });

    return res.json({ ok: true, id: sent.data.id });
  } catch (error) {
    console.error('Gmail send error:', error?.response?.data || error.message);
    return res.status(502).json({ error: 'Could not send email through Gmail API.' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: 'Unexpected server error. Please try again.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
