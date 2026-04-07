/* ═══════════════════════════════════════════════════════════════════════════
   MediaFetch — Support Form Logic
   ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:3001';

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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('support-form');
  const submitBtn = document.getElementById('support-submit-btn');
  const submitLabel = document.getElementById('support-submit-label');
  const submitSpinner = document.getElementById('support-submit-spinner');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name    = document.getElementById('support-name').value.trim();
    const email   = document.getElementById('support-email').value.trim();
    const message = document.getElementById('support-message').value.trim();

    if (!email || !message) {
      showToast('Please fill in your email and message.', 'error');
      return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitLabel.textContent = 'Sending…';
    submitSpinner.classList.remove('hidden');

    try {
      const resp = await fetch(`${API_BASE}/api/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message })
      });

      const data = await resp.json();

      if (!resp.ok) throw new Error(data.error || 'Failed to send message.');

      showToast("Message sent! We'll get back to you within 24 hours. ✨", 'success', 6000);
      form.reset();

    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        // If backend isn't running, show fallback
        showToast(`Message noted! Email us directly: info.shiyos@gmail.com`, 'info', 7000);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      submitBtn.disabled = false;
      submitLabel.textContent = 'Send Message';
      submitSpinner.classList.add('hidden');
    }
  });
});
