'use strict';

const statusBar = document.getElementById('statusBar');
const unlockCard = document.getElementById('unlockCard');
const connectCard = document.getElementById('connectCard');
const mailCard = document.getElementById('mailCard');

const unlockForm = document.getElementById('unlockForm');
const composeForm = document.getElementById('composeForm');
const inboxList = document.getElementById('inboxList');
const messageDetail = document.getElementById('messageDetail');
const refreshBtn = document.getElementById('refreshBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

function setStatus(message, kind = 'info') {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${kind}`;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : {};

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderState(sessionData) {
  const { unlocked, gmailConnected, connectedEmail } = sessionData;

  unlockCard.classList.toggle('hidden', unlocked);
  connectCard.classList.toggle('hidden', !(unlocked && !gmailConnected));
  mailCard.classList.toggle('hidden', !(unlocked && gmailConnected));

  if (!unlocked) {
    setStatus('Site locked. Enter your app password.', 'info');
  } else if (!gmailConnected) {
    setStatus('Site unlocked. Connect Gmail to continue.', 'info');
  } else {
    setStatus(`Connected as ${connectedEmail || 'your account'}.`, 'success');
  }
}

function renderInbox(messages) {
  inboxList.innerHTML = '';

  if (!messages.length) {
    inboxList.innerHTML = '<li class="inbox-item">No inbox messages found.</li>';
    return;
  }

  messages.forEach((msg) => {
    const item = document.createElement('li');
    item.className = 'inbox-item';
    item.innerHTML = `
      <button type="button" data-id="${msg.id}" class="inbox-button">
        <p class="line subject">${escapeHtml(msg.subject)}</p>
        <p class="line from">${escapeHtml(msg.from)}</p>
        <p class="line snippet">${escapeHtml(msg.snippet || '')}</p>
        <p class="line date">${escapeHtml(msg.date || '')}</p>
      </button>
    `;
    inboxList.appendChild(item);
  });
}

function renderMessageDetail(data) {
  messageDetail.innerHTML = `
    <h3>${escapeHtml(data.subject || '(No subject)')}</h3>
    <p><strong>From:</strong> ${escapeHtml(data.from || '')}</p>
    <p><strong>To:</strong> ${escapeHtml(data.to || '')}</p>
    <p><strong>Date:</strong> ${escapeHtml(data.date || '')}</p>
    <hr />
    <pre>${escapeHtml(data.body || '')}</pre>
  `;
}

async function refreshSession() {
  try {
    const session = await apiFetch('/api/session', { method: 'GET' });
    renderState(session);

    if (session.unlocked && session.gmailConnected) {
      await loadInbox();
    }
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function loadInbox() {
  try {
    const data = await apiFetch('/api/inbox', { method: 'GET' });
    renderInbox(data.messages || []);
  } catch (error) {
    setStatus(error.message, 'error');
    alert(`Inbox error: ${error.message}`);
  }
}

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = unlockForm.password.value;

  try {
    await apiFetch('/api/unlock', {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    unlockForm.reset();
    await refreshSession();
  } catch (error) {
    setStatus(error.message, 'error');
    alert(`Unlock failed: ${error.message}`);
  }
});

refreshBtn.addEventListener('click', async () => {
  await loadInbox();
});

inboxList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;

  const messageId = button.getAttribute('data-id');
  if (!messageId) return;

  try {
    const data = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: 'GET'
    });
    renderMessageDetail(data);
  } catch (error) {
    setStatus(error.message, 'error');
    alert(`Message load failed: ${error.message}`);
  }
});

composeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const to = composeForm.to.value;
  const subject = composeForm.subject.value;
  const message = composeForm.message.value;

  try {
    await apiFetch('/api/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, message })
    });

    composeForm.reset();
    setStatus('Email sent successfully.', 'success');
    alert('Email sent.');
  } catch (error) {
    setStatus(error.message, 'error');
    alert(`Send failed: ${error.message}`);
  }
});

disconnectBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/lock', { method: 'POST' });
    messageDetail.innerHTML = '<p>Select an email from the inbox to view details.</p>';
    inboxList.innerHTML = '';
    await refreshSession();
  } catch (error) {
    setStatus(error.message, 'error');
    alert(`Disconnect failed: ${error.message}`);
  }
});

refreshSession();
