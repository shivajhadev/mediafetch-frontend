/* ═══════════════════════════════════════════════════════════════════════════
   Shiyos Media — Main Downloader Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── API Base URL ─────────────────────────────────────────────────────────────
// Auto-detects environment: local dev uses localhost, production uses Render URL.
// After deploying the backend to Render, replace the URL below with your
// Render service URL (e.g. https://shiyos-media-api.onrender.com)
const IS_LOCAL = window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';
const API_BASE = IS_LOCAL
  ? 'http://localhost:3001'
  : 'https://mediafetch-backend.onrender.com';  // ✅ Live Render backend

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  status: 'idle',   // idle | loading | fetched | downloading
  videoData: null,
  selectedFormat: null,  // { formatId, type, quality, size, abr? }
  abortController: null, // AbortController for active download
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
let urlInput, fetchBtn, fetchSpinner, fetchIcon,
  resultSection, skeletonCard, mediaCard,
  videoFormatsGrid, audioFormatsGrid,
  downloadBtn, downloadBtnLabel, downloadBtnSpinner, downloadBtnIcon,
  progressBar, progressFill, progressText,
  historyPanel, historyOverlay, historyList, historyBadge;

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const iconMap = { success: 'check_circle', error: 'error', info: 'info' };
  const colorMap = { success: 'var(--primary)', error: 'var(--error)', info: 'var(--tertiary)' };

  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="material-symbols-outlined icon-filled" style="color:${colorMap[type]};font-size:1.1rem">${iconMap[type]}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ─── UI State Machine ─────────────────────────────────────────────────────────
function setStatus(newStatus) {
  state.status = newStatus;

  // Fetch button
  const isLoading = newStatus === 'loading';
  fetchBtn.disabled = isLoading;
  fetchSpinner.classList.toggle('hidden', !isLoading);
  fetchIcon.classList.toggle('hidden', isLoading);
  fetchBtn.querySelector('span.fetch-label').textContent = isLoading ? 'Fetching…' : 'Fetch';

  // Result section
  if (newStatus === 'loading') {
    resultSection.classList.remove('hidden');
    skeletonCard.classList.remove('hidden');
    mediaCard.classList.add('hidden');
  } else if (newStatus === 'fetched') {
    skeletonCard.classList.add('hidden');
    mediaCard.classList.remove('hidden');
    mediaCard.classList.add('fade-in');
  } else if (newStatus === 'idle') {
    resultSection.classList.add('hidden');
    skeletonCard.classList.add('hidden');
    mediaCard.classList.add('hidden');
  }
}

// ─── Render Media Card ────────────────────────────────────────────────────────
function renderMediaCard(data) {
  // Thumbnail
  const thumb = document.getElementById('video-thumbnail');
  thumb.src = data.thumbnail || '';
  thumb.alt = data.title;

  // Title & channel
  document.getElementById('video-title').textContent = data.title;
  document.getElementById('video-channel').textContent = data.channel;

  // Stats
  document.getElementById('stat-views').textContent = data.viewCount;
  document.getElementById('stat-date').textContent = data.uploadDate;
  document.getElementById('stat-duration').textContent = data.duration;
  document.getElementById('stat-quality').textContent =
    data.videoFormats.length > 0 ? `Up to ${data.videoFormats[0].quality}` : 'Audio only';

  // Render format chips
  renderFormats(data.videoFormats, data.audioFormats);
}

// ─── Render Format Chips ──────────────────────────────────────────────────────
function renderFormats(videoFormats, audioFormats) {
  videoFormatsGrid.innerHTML = '';
  audioFormatsGrid.innerHTML = '';

  videoFormats.forEach((fmt, i) => {
    const chip = createFormatChip(fmt, i === 0);
    videoFormatsGrid.appendChild(chip);
    if (i === 0) {
      state.selectedFormat = fmt;
      updateDownloadButton();
    }
  });

  audioFormats.forEach(fmt => {
    const chip = createFormatChip(fmt, false);
    audioFormatsGrid.appendChild(chip);
  });
}

function createFormatChip(fmt, isSelected) {
  const btn = document.createElement('button');
  btn.className = `format-chip ${isSelected ? 'selected' : ''}`;
  btn.dataset.formatId = fmt.formatId;
  btn.dataset.type = fmt.type;
  btn.dataset.quality = fmt.quality;
  btn.dataset.size = fmt.size || '';
  btn.dataset.abr = fmt.abr || '';
  btn.innerHTML = `
    <span class="chip-label">${fmt.quality}</span>
    <span class="chip-size">${fmt.size || ''}</span>
  `;
  btn.addEventListener('click', () => selectFormat(fmt, btn));
  return btn;
}

function selectFormat(fmt, clickedBtn) {
  // Deselect all
  document.querySelectorAll('.format-chip').forEach(c => c.classList.remove('selected'));
  // Select clicked
  clickedBtn.classList.add('selected');
  state.selectedFormat = fmt;

  // If a download is in progress, cancel it and reset to new selection
  if (state.status === 'downloading' && state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    progressBar.classList.add('hidden');
    progressFill.style.width = '0%';
    showToast('Download cancelled — select the new format and press Download.', 'info', 3500);
    setDownloadingState(false);
  }

  updateDownloadButton();
}

function updateDownloadButton() {
  if (!state.selectedFormat) return;
  const { quality, size, type } = state.selectedFormat;
  const typeLabel = type === 'audio' ? '🎵' : '🎬';
  const sizeStr = size && size !== 'Varies' ? ` • ${size}` : '';
  downloadBtnLabel.textContent = `Download ${typeLabel} ${quality}${sizeStr}`;
}

// ─── Fetch Video ─────────────────────────────────────────────────────────────
async function fetchVideo() {
  const url = urlInput.value.trim();
  if (!url) {
    showToast('Please paste a YouTube URL first.', 'error');
    urlInput.focus();
    return;
  }

  setStatus('loading');
  state.selectedFormat = null;

  try {
    const resp = await fetch(`${API_BASE}/api/formats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || 'Failed to fetch video info.');
    }

    state.videoData = data;
    renderMediaCard(data);
    setStatus('fetched');

  } catch (err) {
    setStatus('idle');
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showToast('Cannot connect to Shiyos Media server. Make sure the backend is running on port 3001.', 'error', 6000);
    } else {
      showToast(err.message, 'error');
    }
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function downloadMedia() {
  if (!state.selectedFormat || !state.videoData) {
    showToast('Please fetch a video and select a format first.', 'error');
    return;
  }
  if (state.status === 'downloading') return;

  // Create a fresh AbortController for this download
  const controller = new AbortController();
  state.abortController = controller;

  const { formatId, type, quality, abr } = state.selectedFormat;
  const url = urlInput.value.trim();
  const historyId = Date.now();

  // Add to history immediately as "downloading"
  addHistoryEntry({
    id: historyId,
    title: state.videoData.title || '',
    thumbnail: state.videoData.thumbnail || '',
    quality: quality || '',
    size: state.selectedFormat.size || '',
    type,
    timestamp: historyId,
    status: 'downloading',
    receivedMB: null,
  });

  setDownloadingState(true);
  showToast(`Starting download: ${quality}…`, 'info', 3000);

  try {
    const resp = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formatId, type, quality: abr ? `${abr}kbps` : quality }),
      signal: controller.signal,   // ← allows cancel via AbortController
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Download failed.' }));
      throw new Error(err.error);
    }

    // Stream to blob → trigger download
    const reader = resp.body.getReader();
    const contentLength = resp.headers.get('Content-Length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    const chunks = [];
    let received = 0;

    // Show progress bar immediately
    progressBar.classList.remove('hidden');
    progressFill.style.width = totalBytes > 0 ? '0%' : '100%'; // pulse if no size
    progressText.textContent = 'Starting…';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const mb = (received / 1024 / 1024).toFixed(1);
      if (totalBytes > 0) {
        const pct = Math.min(100, Math.round((received / totalBytes) * 100));
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `Downloading… ${pct}% (${mb} MB)`;
      } else {
        // Chunked — no total size known, show MB received + animated bar
        const kb = received / 1024;
        const display = kb > 1024 ? `${mb} MB` : `${kb.toFixed(0)} KB`;
        progressText.textContent = `Downloading… ${display} received`;
        // Live update history entry
        updateHistoryEntry(historyId, { receivedMB: mb });
      }
    }

    progressFill.style.width = '100%';
    progressBar.classList.add('hidden');

    // Mark history as completed
    const finalMb = (received / 1024 / 1024).toFixed(1);
    updateHistoryEntry(historyId, { status: 'completed', receivedMB: finalMb });
    showToast('✓ Download complete!', 'success', 4000);

    const mimeType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const safeTitle = (state.videoData.title || 'mediafetch')
      .replace(/[^a-z0-9\-_\s]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60);

    const blob = new Blob(chunks, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${safeTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    showToast(`Download complete! Saved as ${safeTitle}.${ext}`, 'success', 5000);

  } catch (err) {
    progressBar.classList.add('hidden');
    // Ignore AbortError — user cancelled intentionally
    if (err.name === 'AbortError') {
      updateHistoryEntry(historyId, { status: 'failed' });
      return;
    }
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showToast('Cannot connect to server. Is the backend running?', 'error', 6000);
    } else {
      showToast(err.message || 'Download failed. Please try again.', 'error');
    }
    updateHistoryEntry(historyId, { status: 'failed' });
  } finally {
    state.abortController = null;
    setDownloadingState(false);
  }
}

function setDownloadingState(isDownloading) {
  state.status = isDownloading ? 'downloading' : 'fetched';
  downloadBtn.disabled = isDownloading;
  downloadBtn.classList.toggle('is-downloading', isDownloading);
  downloadBtnSpinner.classList.toggle('hidden', !isDownloading);
  downloadBtnIcon.classList.toggle('hidden', isDownloading);
  if (!isDownloading) updateDownloadButton();
  else downloadBtnLabel.textContent = 'Downloading…';
}

// ─── Download History Module ────────────────────────────────────────────────────
const HISTORY_KEY = 'shiyos-dl-history';

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} min ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function renderHistory() {
  if (!historyList) return;
  const history = getHistory();
  const empty = document.getElementById('history-empty');

  // Remove all existing entries (keep empty placeholder)
  historyList.querySelectorAll('.history-entry').forEach(el => el.remove());

  if (history.length === 0) {
    if (empty) empty.style.display = '';
    updateBadge(0);
    return;
  }
  if (empty) empty.style.display = 'none';

  history.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry';
    div.dataset.id = entry.id;

    // Thumb
    const thumbHtml = entry.thumbnail && entry.type !== 'audio'
      ? `<img src="${entry.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="material-symbols-outlined" style="display:none">videocam</span>`
      : `<span class="material-symbols-outlined">music_note</span>`;

    // Status icon + label
    const statusMap = {
      completed:   { icon: 'check_circle', label: 'Done' },
      downloading: { icon: 'downloading',  label: 'Active' },
      failed:      { icon: 'error',        label: 'Failed' },
    };
    const st = statusMap[entry.status] || statusMap.completed;

    // Size display
    const sizeDisplay = entry.receivedMB
      ? (entry.status === 'completed' ? entry.size || `${entry.receivedMB} MB` : `${entry.receivedMB} MB`)
      : (entry.size || '');

    div.innerHTML = `
      <div class="entry-thumb">${thumbHtml}</div>
      <div class="entry-info">
        <div class="entry-name" title="${entry.title || ''}">${
          entry.type === 'audio'
            ? (entry.title || 'Audio download')
            : (entry.title || 'Video download')
        }</div>
        <div class="entry-meta">
          <span class="entry-quality">${entry.quality || ''}</span>
          ${sizeDisplay ? `<span class="entry-size">${sizeDisplay}</span>` : ''}
          <span class="entry-time">${timeAgo(entry.timestamp)}</span>
        </div>
      </div>
      <div class="entry-status ${entry.status}">
        <span class="material-symbols-outlined icon-filled">${st.icon}</span>
        ${st.label}
      </div>
    `;
    historyList.appendChild(div);
  });

  updateBadge(history.filter(h => h.status === 'completed').length);
}

function updateBadge(count) {
  if (!historyBadge) return;
  historyBadge.textContent = count > 9 ? '9+' : count;
  historyBadge.classList.toggle('visible', count > 0);
}

function addHistoryEntry(entry) {
  const history = getHistory();
  history.unshift(entry);
  saveHistory(history);
  renderHistory();
  // Auto-open panel on first download
  if (!historyPanel.classList.contains('open')) {
    openHistoryPanel();
  }
}

function updateHistoryEntry(id, updates) {
  const history = getHistory();
  const i = history.findIndex(h => h.id === id);
  if (i >= 0) {
    history[i] = { ...history[i], ...updates };
    saveHistory(history);
    renderHistory();
  }
}

function openHistoryPanel() {
  historyPanel.classList.add('open');
  historyOverlay.classList.add('open');
}
function closeHistoryPanel() {
  historyPanel.classList.remove('open');
  historyOverlay.classList.remove('open');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  urlInput = document.getElementById('url-input');
  fetchBtn = document.getElementById('fetch-btn');
  fetchSpinner = document.getElementById('fetch-spinner');
  fetchIcon = document.getElementById('fetch-icon');
  resultSection = document.getElementById('result-section');
  skeletonCard = document.getElementById('skeleton-card');
  mediaCard = document.getElementById('media-card');
  videoFormatsGrid = document.getElementById('video-formats-grid');
  audioFormatsGrid = document.getElementById('audio-formats-grid');
  downloadBtn = document.getElementById('download-btn');
  downloadBtnLabel = document.getElementById('download-btn-label');
  downloadBtnSpinner = document.getElementById('download-btn-spinner');
  downloadBtnIcon = document.getElementById('download-btn-icon');
  progressBar = document.getElementById('progress-bar');
  progressFill = document.getElementById('progress-fill');
  progressText = document.getElementById('progress-text');
  historyPanel  = document.getElementById('history-panel');
  historyOverlay = document.getElementById('history-overlay');
  historyList   = document.getElementById('history-list');
  historyBadge  = document.getElementById('history-badge');

  // Event listeners
  fetchBtn.addEventListener('click', fetchVideo);
  downloadBtn.addEventListener('click', downloadMedia);

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchVideo();
  });

  // History panel
  document.getElementById('history-toggle-btn')?.addEventListener('click', () => {
    historyPanel.classList.contains('open') ? closeHistoryPanel() : openHistoryPanel();
  });
  document.getElementById('history-close-btn')?.addEventListener('click', closeHistoryPanel);
  historyOverlay?.addEventListener('click', closeHistoryPanel);
  document.getElementById('history-clear-btn')?.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    showToast('Download history cleared.', 'info', 2500);
  });

  // Load history on startup
  renderHistory();

  // Paste button
  const pasteBtn = document.getElementById('paste-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        urlInput.focus();
      } catch { /* clipboard denied */ }
    });
  }
});
