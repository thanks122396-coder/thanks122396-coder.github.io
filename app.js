const select = selector => document.querySelector(selector);
const selectAll = selector => [...document.querySelectorAll(selector)];
const svgNamespace = 'http://www.w3.org/2000/svg';
const maxAmount = 1e12;
const displayNames = { USD: 'الدولار الأمريكي', IQD: 'الدينار العراقي', SAR: 'الريال السعودي', AED: 'الدرهم الإماراتي' };
const currencyCodes = Object.keys(displayNames);
const dateFormat = new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormats = new Map();
const input = select('#amount');
const output = select('#converted');
const refresh = select('#refresh');
const picker = document.createElement('select');
picker.id = 'currency';
picker.setAttribute('aria-label', 'العملة المقابلة لعملة Pi');
for (const code of currencyCodes) {
  const option = new Option(code, code);
  option.title = displayNames[code];
  picker.add(option);
}

let market = null;
let reversed = false;
let period = 1;
let converted = null;
let toastTimer;

function format(number, minimum = 0, maximum = minimum) {
  const key = `${minimum}:${maximum}`;
  if (!numberFormats.has(key)) {
    numberFormats.set(key, new Intl.NumberFormat('en-US', { minimumFractionDigits: minimum, maximumFractionDigits: maximum }));
  }
  return numberFormats.get(key).format(number);
}

function priceDisplay(value, code) {
  if (!Number.isFinite(value)) return '—';
  return code === 'USD' ? `$${format(value, 4, 6)}` : format(value, 2, 4);
}

function parseNumber(value, upperLimit) {
  if (!value.trim()) return null;
  let normalized = value.trim().replace(/[٠-٩]/g, character => String(character.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, character => String(character.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.').replace(/[٬\s]/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(normalized)) normalized = normalized.replaceAll(',', '');
  else normalized = normalized.replace(',', '.');
  const number = Number(normalized);
  return /^\d+(\.\d*)?$|^\.\d+$/.test(normalized) && Number.isFinite(number) && number <= upperLimit ? number : NaN;
}

function setMessage(target, message) {
  target.textContent = message;
  target.hidden = !message;
}

function svgElement(tag, attrs = {}) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function refreshPickers() {
  const pi = document.createElement('span');
  pi.className = 'mini-pi';
  pi.textContent = 'π';
  pi.setAttribute('aria-hidden', 'true');
  const flag = svgElement('svg', { class: 'flag picker-flag', 'aria-hidden': 'true' });
  flag.append(svgElement('use', { href: `#f-${picker.value}` }));
  const from = select('#from-pick');
  const to = select('#to-pick');
  (reversed ? to : from).replaceChildren(pi, 'PI');
  (reversed ? from : to).replaceChildren(flag, picker);
}

function convert() {
  const code = picker.value;
  const rate = market?.prices[code];
  const amount = parseNumber(input.value, maxAmount);
  const message = Number.isNaN(amount) ? 'أدخل مبلغًا صحيحًا بين صفر وتريليون.' : '';
  setMessage(select('#convert-error'), message);
  input.setAttribute('aria-invalid', String(Boolean(message)));
  const equation = select('#equation');
  if (Number.isFinite(rate)) {
    const expression = document.createElement('bdi');
    expression.textContent = `1 PI ≈ ${format(rate, code === 'USD' ? 4 : 2, 6)} ${code}`;
    equation.replaceChildren(expression);
  } else {
    equation.textContent = refresh.disabled ? 'جارٍ جلب سعر السوق' : 'سعر هذه العملة غير متاح حاليًا';
  }
  converted = amount !== null && !message && Number.isFinite(rate) ? (reversed ? amount / rate : amount * rate) : null;
  output.value = converted !== null ? format(converted, reversed ? 0 : 2, reversed ? 8 : 6) : '—';
  select('#copy-result').disabled = converted === null;
}

function showToast(message) {
  const toast = select('#toast');
  clearTimeout(toastTimer);
  setMessage(toast, message);
  toastTimer = setTimeout(() => setMessage(toast, ''), 2800);
}

function copyText(value) {
  if (!navigator.clipboard) return Promise.reject(new Error('Clipboard not available'));
  return navigator.clipboard.writeText(value);
}

function changeBadge(element, delta, description) {
  element.hidden = !Number.isFinite(delta);
  if (element.hidden) return;
  element.textContent = `${delta > 0 ? '+' : ''}${format(delta, 2)}%`;
  element.title = description;
  element.setAttribute('aria-label', `${description}: ${element.textContent}`);
  element.classList.toggle('negative', delta < 0);
}

function chartDate(seconds) {
  const timestamp = new Date(seconds * 1000);
  if (period === 1) return `${String(timestamp.getUTCHours()).padStart(2, '0')}:00`;
  return `${timestamp.getUTCMonth() + 1}/${timestamp.getUTCDate()}`;
}

function drawChart() {
  const chart = select('#chart');
  const empty = select('#chart-empty');
  select('#chart-price').textContent = priceDisplay(market?.usd, 'USD');
  const last = market?.history.at(-1);
  const points = last ? market.history.filter(([time]) => time >= last[0] - period * 86400) : [];
  const isAvailable = points.length > 1;
  chart.toggleAttribute('hidden', !isAvailable);
  empty.hidden = isAvailable;
  const base = points[0]?.[1];
  const delta = isAvailable ? (last[1] / base - 1) * 100 : period === 1 ? market?.change : null;
  const description = period === 1 ? 'التغيّر خلال 24 ساعة' : `التغيّر خلال ${period} أيام`;
  changeBadge(select('#chart-change'), delta, description);
  if (!isAvailable) {
    empty.textContent = refresh.disabled ? 'جارٍ تحميل بيانات السوق…' : 'لا تتوفر بيانات الرسم البياني حاليًا';
    return;
  }
  const prices = points.map(point => point[1]);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const padding = Math.max((high - low) * .17, high * .002);
  const min = low - padding;
  const max = high + padding;
  const top = 12;
  const bottom = 140;
  const left = 8;
  const right = 415;
  const guides = select('#chart-guides');
  const ticks = [];
  for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
    const row = top + (bottom - top) * fraction;
    ticks.push(svgElement('line', { x1: left, x2: right, y1: row, y2: row, stroke: '#393d56', 'stroke-dasharray': '4 5' }));
    const label = svgElement('text', { x: 475, y: row + 4, 'text-anchor': 'end' });
    label.textContent = `$${format(max - ((max - min) * fraction), 3, 4)}`;
    ticks.push(label);
  }
  const fromTime = points[0][0];
  for (const fraction of [0, .33, .66, 1]) {
    const label = svgElement('text', { x: left + fraction * (right - left), y: 163, 'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle' });
    label.textContent = chartDate(fromTime + fraction * (last[0] - fromTime));
    ticks.push(label);
  }
  guides.replaceChildren(...ticks);
  const count = Math.min(109, points.length);
  const coords = Array.from({ length: count }, (_, index) => {
    const [time, price] = points[Math.round(index * (points.length - 1) / (count - 1))];
    return [left + ((time - fromTime) / (last[0] - fromTime)) * (right - left), bottom - ((price - min) / (max - min)) * (bottom - top)];
  });
  const path = `M${coords.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')}`;
  select('#chart-line').setAttribute('d', path);
  select('#chart-area').setAttribute('d', `${path} L${right} ${bottom} L${left} ${bottom} Z`);
  const end = select('#chart-end');
  end.setAttribute('cx', coords.at(-1)[0]);
  end.setAttribute('cy', coords.at(-1)[1]);
  select('#chart-caption').textContent = `${description} (UTC)، من ${priceDisplay(base, 'USD')} إلى ${priceDisplay(last[1], 'USD')}`;
}

function marketStatus(state, text) {
  const badge = select('#market-status');
  badge.dataset.state = state;
  badge.replaceChildren(badge.firstElementChild, text);
}

async function loadMarket() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  marketStatus('loading', 'جارٍ جلب الأسعار');
  try {
    const response = await fetch('/api/market', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Market data unavailable');
    const data = await response.json();
    if (!Number.isFinite(data.usd) || !data.prices || !Array.isArray(data.history)) throw new Error('Invalid market data');
    market = data;
    const hasAllQuotes = currencyCodes.every(code => Number.isFinite(data.prices[code]));
    marketStatus(hasAllQuotes ? 'ready' : 'stale', hasAllQuotes ? 'أسعار السوق' : 'تحديث جزئي');
    select('#market-detail').textContent = `آخر قراءة للسوق: ${dateFormat.format(new Date(data.observedAt))} · ${data.source}${data.fxUpdatedAt ? ` · تحديث الصرف: ${dateFormat.format(new Date(data.fxUpdatedAt))}` : ' · أسعار الصرف غير متاحة'}`;
    for (const card of selectAll('[data-rate]')) {
      const code = card.dataset.rate;
      card.querySelector('.rate-value').textContent = priceDisplay(data.prices[code], code);
      const detail = card.querySelector('.rate-note');
      if (detail) detail.textContent = Number.isFinite(data.prices[code]) ? 'سعر تقريبي' : 'غير متاح';
      const badge = card.querySelector('.rate-change');
      if (badge) changeBadge(badge, data.change, 'التغيّر خلال 24 ساعة');
    }
  } catch {
    marketStatus('stale', market ? 'آخر سعر متاح' : 'الأسعار غير متاحة');
    const previous = market ? ` · ${market.source} · ${dateFormat.format(new Date(market.observedAt))}` : '';
    select('#market-detail').textContent = `تعذّر تحديث الأسعار. استخدم زر التحديث للمحاولة مرة أخرى${previous}.`;
  } finally {
    refresh.disabled = false;
    convert();
    drawChart();
  }
}

function calculateLockup() {
  const sessionsInput = select('#sessions');
  const baseInput = select('#base-rate');
  const sessions = parseNumber(sessionsInput.value, 1e7);
  const base = parseNumber(baseInput.value, 1e6);
  const validSessions = Number.isInteger(sessions);
  const validBase = !Number.isNaN(base);
  sessionsInput.setAttribute('aria-invalid', String(sessions !== null && !validSessions));
  baseInput.setAttribute('aria-invalid', String(!validBase));
  setMessage(select('#lockup-error'), sessions !== null && !validSessions ? 'أدخل عدد جلسات صحيحًا غير سالب لا يتجاوز 10 ملايين.' : !validBase ? 'أدخل معدّل تعدين صحيحًا غير سالب لا يتجاوز مليونًا.' : '');
  const ratio = Number(select('#lock-percent').value) / 100;
  const duration = Number(select('#lock-duration').value);
  const boost = validSessions ? ratio * duration * Math.log10(Math.max(1, sessions)) : null;
  const reward = boost !== null && base !== null && validBase ? boost * base : null;
  select('#boost').textContent = boost === null ? '—' : `${boost > 0 ? '+' : ''}${format(boost * 100, 0, 2)}%`;
  select('#bonus-hour').textContent = reward === null ? '—' : `${format(reward, 0, 8)} Pi`;
  select('#bonus-day').textContent = reward === null ? '—' : `${format(reward * 24, 0, 8)} Pi`;
}

const dialog = select('#account-dialog');
const accountStatus = select('#account-status');
const accountGuide = select('#account-guide');
let username = null;
let sdkPromise;
let authAttempt = 0;

function loadPiSdk() {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.minepi.com/pi-sdk.js';
      script.async = true;
      script.onload = () => {
        try {
          window.Pi.init({ version: '2.0', sandbox: false });
          resolve(window.Pi);
        } catch {
          script.remove();
          reject(new Error('Pi SDK unavailable'));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Pi SDK unavailable'));
      };
      document.head.append(script);
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

function updateAccount() {
  select('#login-label').textContent = username ? `@${username}` : 'الدخول بحساب Pi';
  select('#login').setAttribute('aria-label', username ? 'عرض حساب Pi' : 'الدخول بحساب Pi');
  select('#account-title').textContent = username ? 'حساب Pi' : 'الدخول بحساب Pi';
  accountGuide.hidden = true;
  select('#sign-out').hidden = !username;
}

async function signIn() {
  updateAccount();
  dialog.showModal();
  if (username) {
    accountStatus.textContent = `تم التحقق من حسابك: @${username}`;
    return;
  }
  accountStatus.textContent = 'جارٍ التحقق من توفر تسجيل الدخول…';
  const attempt = ++authAttempt;
  let configured = false;
  let timeout;
  try {
    const status = await fetch('/api/pi/status', { signal: AbortSignal.timeout(8000) });
    if (!status.ok) throw new Error('Pi status unavailable');
    const settings = await status.json();
    if (attempt !== authAttempt || !dialog.open) return;
    configured = settings.configured === true;
    if (!configured) {
      accountStatus.textContent = 'تسجيل الدخول بحساب Pi غير مفعّل بعد. يمكنك استخدام محوّل العملات وحاسبة القفل دون حساب.';
      return;
    }
    accountStatus.textContent = 'جارٍ الاتصال بـ Pi Network…';
    accountGuide.hidden = false;
    const authenticate = async () => {
      const sdk = await loadPiSdk();
      if (attempt !== authAttempt || !dialog.open) return null;
      return sdk.authenticate(['username'], () => {});
    };
    const credentials = await Promise.race([
      authenticate(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Pi authentication timed out')), 45000); }),
    ]);
    if (attempt !== authAttempt || !dialog.open || !credentials) return;
    if (!credentials.accessToken) throw new Error('Missing Pi authorization');
    const response = await fetch('/api/pi/verify', {
      method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Pi verification failed');
    const profile = await response.json();
    if (typeof profile.username !== 'string' || !profile.username) throw new Error('Missing profile');
    if (attempt !== authAttempt || !dialog.open) return;
    username = profile.username;
    updateAccount();
    dialog.close();
    showToast('تم تسجيل الدخول بحساب Pi');
  } catch {
    if (attempt === authAttempt && dialog.open) {
      accountStatus.textContent = configured
        ? 'لم يكتمل تسجيل الدخول. تأكّد من فتح التطبيق في Pi Browser ثم أعد المحاولة.'
        : 'تعذّر التحقق من توفر تسجيل الدخول. أعد المحاولة لاحقًا.';
    }
  } finally {
    clearTimeout(timeout);
  }
}

function activeNavigation() {
  const section = ['#converter', '#lockup'].includes(location.hash) ? location.hash : '#top';
  for (const link of selectAll('.nav-link')) {
    const active = link.getAttribute('href') === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

refreshPickers();
input.addEventListener('input', convert);
picker.addEventListener('change', () => {
  select('.picker-flag use').setAttribute('href', `#f-${picker.value}`);
  convert();
});
select('#swap').addEventListener('click', () => {
  if (converted !== null && converted <= maxAmount) input.value = format(converted, 0, 12).replaceAll(',', '');
  reversed = !reversed;
  refreshPickers();
  convert();
});
select('#copy-result').addEventListener('click', async () => {
  try {
    await copyText(`${output.value} ${reversed ? 'PI' : picker.value}`);
    showToast('نُسخت نتيجة التحويل');
  } catch {
    showToast('تعذّر النسخ تلقائيًا');
  }
});
for (const button of selectAll('[data-period]')) {
  button.title = { 1: 'آخر 24 ساعة', 7: 'آخر 7 أيام', 30: 'آخر 30 يومًا' }[button.dataset.period];
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', () => {
    period = Number(button.dataset.period);
    for (const item of selectAll('[data-period]')) item.setAttribute('aria-pressed', String(item === button));
    drawChart();
  });
}
select('#lockup-form').addEventListener('input', calculateLockup);
select('#lockup-form').addEventListener('submit', event => event.preventDefault());
refresh.addEventListener('click', loadMarket);
select('#login').addEventListener('click', signIn);
select('#dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { authAttempt += 1; });
select('#copy-link').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await copyText(new URL('/', location.origin).href);
    button.textContent = 'تم نسخ رابط التطبيق';
  } catch {
    accountStatus.textContent = 'انسخ رابط التطبيق من شريط العنوان.';
  }
});
select('#sign-out').addEventListener('click', () => {
  username = null;
  updateAccount();
  dialog.close();
  showToast('تم تسجيل الخروج من التطبيق');
});
window.addEventListener('hashchange', activeNavigation);
activeNavigation();
calculateLockup();
loadMarket();
convert();
setInterval(() => { if (!document.hidden) loadMarket(); }, 120000);
