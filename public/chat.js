// Beauty advisor chat: a text conversation with the server-side advisor, saved per account.
import { wearsHijab } from './options.js';
import { $, api } from './ui.js';

const dialog = $('#consult-dialog');
const list = $('#chat-messages');
const form = $('#chat-form');
const input = $('#chat-input');
const send = $('#chat-send');
const error = $('#chat-error');
const contextChip = $('#chat-context');
const suggestionBar = $('#chat-suggestions');
const clearButton = $('#chat-clear');

let userId = null;
let hijab = false;
let event = null; // occasion open in the editor; gives the advisor its context
let messages = [];
let busy = false;
let epoch = 0;

const welcome =
  'أهلاً فيكِ 🌷 أنا مستشارتك للجمال والإطلالات. احكيلي عن مناسبتك، ألوانك أو الإطلالة اللي ببالك، ومنرتّب التفاصيل سوا.';
const starters = () =>
  hijab
    ? ['شو بلبس لمقابلة عمل مع الحجاب؟', 'أي لفة حجاب بتناسب شكل وجهي؟', 'كيف بنسّق لون الحجاب مع الفستان؟']
    : ['شو بلبس لمقابلة عمل؟', 'أي تسريحة بتناسب شكل وجهي؟', 'كيف بنسّق ألوان المكياج؟'];

function bubble(text, role, id) {
  const row = document.createElement('article');
  row.className = 'chat-row ' + role;
  const body = document.createElement('div');
  body.className = 'chat-bubble';
  body.textContent = text;
  row.append(body);
  if (id) row.dataset.messageId = id;
  return row;
}

function draw() {
  list.replaceChildren(bubble(welcome, 'assistant'));
  for (const message of messages) list.append(bubble(message.text, message.role, message.id));
  if (busy) list.append(bubble('المستشارة تكتب…', 'assistant typing'));
  send.disabled = busy || !userId;
  input.disabled = !userId;
  input.placeholder = userId ? 'احكيلي عن الإطلالة اللي ببالك…' : 'سجّلي الدخول لبدء المحادثة';
  contextChip.hidden = !event;
  contextChip.textContent = event ? `سياق المحادثة: ${event.type} · ${event.date}` : '';
  clearButton.hidden = !messages.length || busy;
  suggestionBar.hidden = messages.length > 0;
  suggestionBar.replaceChildren(
    ...starters().map((text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.onclick = () => {
        input.value = text;
        if (userId) form.requestSubmit();
      };
      return button;
    }),
  );
  list.scrollTop = list.scrollHeight;
}

async function load() {
  if (busy) return draw();
  const token = ++epoch;
  error.textContent = '';
  if (!userId) {
    messages = [];
    draw();
    error.textContent = 'سجّلي الدخول لحفظ محادثتك بشكل خاص.';
    return;
  }
  try {
    const data = await api('/api/chat');
    if (token !== epoch) return;
    messages = data.messages;
    draw();
  } catch (e) {
    if (token === epoch) error.textContent = e.message;
  }
}

$('#consult').addEventListener('click', () => {
  if (!dialog.open) dialog.showModal();
  load();
  input.focus();
});
$('.close', dialog).onclick = () => dialog.close();
// Clicking the backdrop closes the dialog, like every other modal sheet.
dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

clearButton.onclick = async () => {
  if (busy || !confirm('مسح كل رسائل المحادثة المحفوظة؟')) return;
  try {
    await api('/api/chat', null, 'DELETE');
    ++epoch;
    messages = [];
    draw();
  } catch (e) {
    error.textContent = e.message;
  }
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (busy || !userId || !text) return;
  const token = epoch;
  const owner = userId;
  busy = true;
  error.textContent = '';
  messages.push({ text, role: 'user', pending: true });
  input.value = '';
  input.style.height = '';
  draw();
  try {
    const data = await api('/api/chat', { message: text, eventId: event?.id });
    if (owner !== userId || token !== epoch) return;
    messages = messages.filter((m) => !m.pending);
    messages.push(...data.messages);
  } catch (e) {
    if (owner === userId && token === epoch) {
      messages = messages.filter((m) => !m.pending);
      input.value = text; // nothing is lost: the unsent text returns to the composer
      error.textContent = e.message;
    }
  } finally {
    busy = false;
    if (owner === userId) draw();
  }
};

input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
};
input.oninput = () => {
  input.style.height = '38px';
  input.style.height = Math.min(120, input.scrollHeight) + 'px';
};

window.addEventListener('sab-user-state', (e) => {
  const next = e.detail?.id || null;
  hijab = wearsHijab(e.detail?.profile);
  if (next !== userId) {
    ++epoch;
    userId = next;
    event = null;
    messages = [];
    input.value = '';
    error.textContent = '';
    if (dialog.open) load();
  }
  draw();
});
window.addEventListener('sab-start-event', (e) => {
  event = e.detail.event;
  draw();
});
for (const name of ['sab-leave-event', 'sab-account-cleared', 'sab-edit-profile'])
  window.addEventListener(name, () => {
    event = null;
    draw();
  });

draw();
