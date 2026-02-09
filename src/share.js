const entryTitle = document.querySelector('#share-entry-title');
const entryMeta = document.querySelector('#share-entry-meta');
const entryBody = document.querySelector('#share-entry-body');
const shareStatus = document.querySelector('#share-status');
const commentsList = document.querySelector('#share-comments-list');
const refreshButton = document.querySelector('#share-refresh');
const commentForm = document.querySelector('#share-comment-form');
const commentNameInput = document.querySelector('#share-comment-name');
const commentBodyInput = document.querySelector('#share-comment-body');
const commentSubmit = document.querySelector('#share-comment-submit');
const commentStatus = document.querySelector('#share-comment-status');

const token = getShareToken();

if (!token) {
  setStatus('Missing share link.');
  entryBody.textContent = 'No share token was found in the URL.';
  disableCommentForm();
} else {
  void loadEntry();
  void loadComments();
}

refreshButton?.addEventListener('click', () => {
  void loadComments();
});

commentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!token) {
    return;
  }
  const author = commentNameInput?.value.trim() || '';
  const body = commentBodyInput?.value.trim() || '';
  if (!body) {
    commentStatus.textContent = 'Please enter a comment.';
    return;
  }

  commentStatus.textContent = '';
  commentSubmit.disabled = true;
  commentBodyInput.disabled = true;
  commentNameInput.disabled = true;

  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, body })
    });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to send feedback.');
    }

    commentBodyInput.value = '';
    commentStatus.textContent = 'Feedback sent.';
    await loadComments({ silent: true });
  } catch (error) {
    commentStatus.textContent = error?.message || 'Failed to send feedback.';
  } finally {
    commentSubmit.disabled = false;
    commentBodyInput.disabled = false;
    commentNameInput.disabled = false;
  }
});

async function loadEntry() {
  if (!token) {
    return;
  }
  setStatus('Loading…');
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}`);
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || 'Share not found.');
    }
    const entry = data?.entry || {};
    entryTitle.textContent = entry.title || 'Shared entry';
    entryBody.textContent = entry.text || '';

    if (entry.updatedAt) {
      const date = new Date(entry.updatedAt);
      entryMeta.textContent = Number.isNaN(date.getTime()) ? '' : `Updated ${formatTimestamp(date)}`;
    } else {
      entryMeta.textContent = '';
    }

    setStatus('Ready');
  } catch (error) {
    setStatus(error?.message || 'Share not found.');
    entryBody.textContent = 'This shared entry could not be loaded.';
    disableCommentForm();
  }
}

async function loadComments({ silent = false } = {}) {
  if (!token) {
    return;
  }
  if (!silent) {
    commentsList.textContent = 'Loading feedback…';
  }
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}/comments`);
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load feedback.');
    }
    renderComments(Array.isArray(data?.comments) ? data.comments : []);
  } catch (error) {
    commentsList.textContent = error?.message || 'Failed to load feedback.';
  }
}

function renderComments(comments) {
  commentsList.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement('div');
    empty.className = 'share-empty';
    empty.textContent = 'No feedback yet.';
    commentsList.appendChild(empty);
    return;
  }

  comments.forEach((comment) => {
    const card = document.createElement('div');
    card.className = 'share-comment-card';

    const meta = document.createElement('div');
    meta.className = 'share-comment-meta';
    const author = comment.author || 'Anonymous';
    const timestamp = comment.createdAt ? formatTimestamp(new Date(comment.createdAt)) : '';
    meta.textContent = timestamp ? `${author} · ${timestamp}` : author;

    const body = document.createElement('div');
    body.className = 'share-comment-body';
    body.textContent = comment.body || '';

    card.appendChild(meta);
    card.appendChild(body);
    commentsList.appendChild(card);
  });
}

function setStatus(text) {
  if (!shareStatus) {
    return;
  }
  shareStatus.textContent = text;
}

function disableCommentForm() {
  commentForm?.classList.add('is-disabled');
  if (commentBodyInput) {
    commentBodyInput.disabled = true;
  }
  if (commentNameInput) {
    commentNameInput.disabled = true;
  }
  if (commentSubmit) {
    commentSubmit.disabled = true;
  }
}

function formatTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function getShareToken() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return queryToken;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    return '';
  }
  const shareIndex = parts.findIndex((part) => part === 'share' || part === 's');
  if (shareIndex >= 0 && parts[shareIndex + 1]) {
    return parts[shareIndex + 1];
  }
  return parts[parts.length - 1] || '';
}
