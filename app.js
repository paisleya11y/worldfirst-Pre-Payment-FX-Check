/* ============================================================
 * WorldFirst AI 资金建议 — 演示交互脚本
 * 主链路：脚本化（视觉/数据稳定）
 * 追问对话：通过 /api/chat 走 DeepSeek 真 LLM（fallback 脚本预设）
 * ============================================================ */

// ----- 用户画像 + Mock 数据（统一写死，保持前后一致） -----
const USER_PROFILE = {
  business: 'TikTok Shop + Shopify 独立站跨境卖家',
  monthlyGmv: '约 50 万美元',
  balances: {
    USD: 58234.21,
    EUR: 12418.50,
    HKD: 32610.00,
  },
  // 近 30 天 USD 付款历史（用于「保留外币」场景的依据）
  recentUsdPayments: {
    count: 5,
    avg: 6420,
    total: 32100,
    breakdown: [
      { type: 'Meta Ads', count: 2, total: 12400 },
      { type: 'Google Ads', count: 1, total: 8200 },
      { type: 'Shopify 订阅', count: 1, total: 320 },
      { type: '海外仓 (US)', count: 1, total: 11180 },
    ],
  },
  // 近 30 天 RMB 付款历史（用于「付供应商」场景的依据）
  recentRmbPayments: {
    count: 4,
    avg: 186000,
    total: 744000,
  },
  fxQuotaCny: 410000, // 本月可结汇额度（已使用部分后剩余）
  // 「额度不足」场景：缺凭证的订单
  missingProofs: 3,
};

// ----- 当前状态 -----
const STATE = {
  amount: 0,             // 兑出金额
  fromCurrency: 'USD',
  toCurrency: 'CNH',
  refRate: 7.0190,
  scenario: '保留外币付款', // 默认场景
  expanded: false,
  chatHistory: [],
};

// ----- 4 个场景配置 -----
const SCENARIOS = {
  '保留外币付款': {
    type: 'main',                 // 主动建议（介入强度 B）
    cardClass: '',                 // 默认玫红
    purposeLabel: '保留外币付款',
    icon: '💡',
    evidenceFn: (amount) => {
      const p = USER_PROFILE.recentUsdPayments;
      return `你近 30 天有 <strong>${p.count} 笔 USD 付款</strong>记录（Meta/Google 广告、Shopify、海外仓），共 <strong>$${p.total.toLocaleString()}</strong>。<br>若全部 ${currency('USD')} ${amount.toLocaleString()} 兑换为 RMB，下月再付美元支出时会产生<strong>二次换汇成本</strong>。`;
    },
    planFn: (amount) => {
      const reserve = 30000;
      const convert = Math.max(amount - reserve, 0);
      return [
        {
          num: '1',
          title: `兑换 ${convert.toLocaleString()} USD → CNH`,
          desc: '覆盖近期人民币需求，按当前汇率即时成交',
        },
        {
          num: '2',
          title: `保留 ${reserve.toLocaleString()} USD`,
          desc: '用于下月 Meta / Google 等美元支出，避免二次换汇',
        },
        {
          num: '3',
          title: '设置 USD/CNH 汇率提醒（参考目标 7.05）',
          desc: '到达目标价时通知你，再决定是否兑换剩余部分',
        },
      ];
    },
    pathFn: (amount) => ({
      current: `全部兑换 ${amount.toLocaleString()} USD → CNH`,
      suggest: `兑换 ${(amount - 30000).toLocaleString()} USD + 保留 30,000 USD`,
      diff: '避免一次未来二次换汇链路，按当前费率估算可减少路径成本约 ¥XXX*',
    }),
    actions: [
      { label: '一键应用建议', kind: 'primary', onclick: 'applyMainSuggestion()' },
      { label: '设置汇率提醒', kind: 'secondary', onclick: 'setRateAlert()' },
      { label: '继续全部兑换', kind: 'ghost', onclick: 'continueOriginal()' },
      { label: '追问 AI', kind: 'outline', onclick: 'openChat()' },
    ],
  },

  '付供应商': {
    type: 'silent',                 // 静默校验（介入强度 A）
    cardClass: 'silent',
    purposeLabel: '付国内供应商',
    icon: '✓',
    evidenceFn: () => {
      const p = USER_PROFILE.recentRmbPayments;
      return `<strong>已校验：</strong>额度充足 (剩余 ¥${(USER_PROFILE.fxQuotaCny).toLocaleString()})、凭证完整。<br>历史 ${p.count} 笔人民币供应商付款，本次金额在合理区间，可完成本次兑换。`;
    },
    planFn: null,
    pathFn: null,
    actions: [
      { label: '继续兑换', kind: 'primary', onclick: 'continueOriginal()' },
      { label: '追问 AI', kind: 'ghost', onclick: 'openChat()' },
    ],
  },

  '暂时不用': {
    type: 'main',                   // 主动建议（克制版）
    cardClass: 'warning',
    purposeLabel: '暂时不用',
    icon: '○',
    evidenceFn: (amount) => {
      return `这笔 ${currency('USD')} ${amount.toLocaleString()} <strong>暂时没有明确用途</strong>。<br>当前 USD 处于近 30 天偏高区间（仅作背景参考，不代表未来走势）。`;
    },
    planFn: (amount) => {
      const half = Math.round(amount / 2 / 1000) * 1000;
      return [
        {
          num: '1',
          title: `分批兑换：先兑 ${half.toLocaleString()} USD`,
          desc: '降低单点择时风险，剩余部分等明确用途再决定',
        },
        {
          num: '2',
          title: '设置 USD/CNH 汇率提醒',
          desc: '到达目标价时通知，再判断是否兑换剩余部分',
        },
        {
          num: '3',
          title: '暂不兑换',
          desc: '保持外币余额，等待明确经营用途',
        },
      ];
    },
    pathFn: null,
    actions: [
      { label: '分批兑换', kind: 'primary', onclick: 'applyHalfConvert()' },
      { label: '设置汇率提醒', kind: 'secondary', onclick: 'setRateAlert()' },
      { label: '暂不兑换', kind: 'ghost', onclick: 'cancelExchange()' },
      { label: '追问 AI', kind: 'outline', onclick: 'openChat()' },
    ],
  },

  '不确定': {
    type: 'danger',                 // 异常拦截（介入强度 C）
    cardClass: 'danger',
    purposeLabel: '可结汇额度不足',
    icon: '⚠',
    evidenceFn: (amount) => {
      const need = Math.round(amount * STATE.refRate);
      const remain = USER_PROFILE.fxQuotaCny;
      const maxConvert = Math.floor(remain / STATE.refRate);
      return `当前可结汇额度 <strong>¥${remain.toLocaleString()}</strong>，本次兑换需要约 <strong>¥${need.toLocaleString()}</strong>。<br>预计本次最多可结汇 <strong>${maxConvert.toLocaleString()} USD</strong>。<br>原因：你绑定的店铺有 <strong>${USER_PROFILE.missingProofs} 笔订单未补充贸易凭证</strong>（境内合作伙伴展业三原则要求）。`;
    },
    planFn: () => {
      return [
        {
          num: '1',
          title: '先去「店铺管理 → 额度管理」补凭证',
          desc: '上传缺失的物流单 / 商品发票，预计 2 分钟可恢复额度',
        },
        {
          num: '2',
          title: '凭证补齐后再继续兑换',
          desc: '完整额度恢复后，可避免本次额度受限',
        },
        {
          num: '3',
          title: `或先兑换 ${Math.floor(USER_PROFILE.fxQuotaCny / STATE.refRate).toLocaleString()} USD`,
          desc: '在当前可用额度内完成部分兑换',
        },
      ];
    },
    pathFn: null,
    actions: [
      { label: '去额度管理补充凭证', kind: 'danger', onclick: 'goQuotaPage()' },
      { label: '查看缺失清单', kind: 'secondary', onclick: 'showMissingList()' },
      { label: `先兑换 ${Math.floor(USER_PROFILE.fxQuotaCny / 7.0190).toLocaleString()} USD`, kind: 'ghost', onclick: 'applyPartialByQuota()' },
    ],
  },
};

function currency(c) {
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return '';
}

// ============================================================
// 渲染 AI 卡
// ============================================================
function renderAiCard() {
  const mount = document.getElementById('ai-card-mount');
  if (!mount) return;
  const amount = STATE.amount;

  // 输入金额 < 阈值 时不展示卡片
  if (!amount || amount < 10000) {
    mount.innerHTML = '';
    return;
  }

  const sc = SCENARIOS[STATE.scenario];
  const evidence = sc.evidenceFn(amount);
  const plan = sc.planFn ? sc.planFn(amount) : null;
  const path = sc.pathFn ? sc.pathFn(amount) : null;

  let bodyHtml = '';
  if (sc.type !== 'silent' && plan) {
    let stepsHtml = plan.map(s => `
      <div class="wf-ai-step">
        <div class="wf-ai-step-num">${s.num}</div>
        <div class="wf-ai-step-content">
          <div class="wf-ai-step-title">${s.title}</div>
          <div class="wf-ai-step-desc">${s.desc}</div>
        </div>
      </div>
    `).join('');

    let pathHtml = '';
    if (path) {
      pathHtml = `
        <div class="wf-ai-path">
          <div class="wf-ai-path-row"><span class="wf-ai-path-label">当前路径</span><span>${path.current}</span></div>
          <div class="wf-ai-path-row"><span class="wf-ai-path-label">建议路径</span><span>${path.suggest}</span></div>
          <div class="wf-ai-path-row diff"><span class="wf-ai-path-label">差异</span><span>${path.diff}</span></div>
        </div>`;
    }

    bodyHtml = `
      <div class="wf-ai-body ${STATE.expanded ? 'expanded' : ''}" id="ai-body">
        <div class="wf-ai-plan-title">建议方案：</div>
        ${stepsHtml}
        ${pathHtml}
      </div>
    `;
  }

  let actionsHtml = sc.actions.map(a => `
    <button class="wf-ai-btn ${a.kind}" onclick="${a.onclick}">${a.label}</button>
  `).join('');

  // 如果是 main 类型，且未展开，把"查看建议方案"放最前
  if (sc.type === 'main' && !STATE.expanded) {
    actionsHtml = `<button class="wf-ai-btn primary" onclick="expandAiCard()">查看建议方案</button>` + actionsHtml.replace(/onclick=\"[^\"]*\"/, function(m) {
      // 第一个按钮（主按钮）已经被替换为"查看建议方案"，原主按钮变次按钮显示在抽屉打开后
      return m;
    });
    // 简化：仅在折叠态展示 [查看建议方案] + [继续全部兑换] + [追问]
    actionsHtml = `
      <button class="wf-ai-btn primary" onclick="expandAiCard()">查看建议方案</button>
      <button class="wf-ai-btn ghost" onclick="continueOriginal()">继续全部兑换</button>
      <button class="wf-ai-btn outline" onclick="openChat()">追问 AI</button>
    `;
  } else if (sc.type === 'main' && STATE.expanded) {
    // 展开态：显示完整按钮组
    actionsHtml = sc.actions.map(a => `
      <button class="wf-ai-btn ${a.kind}" onclick="${a.onclick}">${a.label}</button>
    `).join('');
  }

  mount.innerHTML = `
    <div class="wf-ai-card ${sc.cardClass}">
      <div class="wf-ai-head">
        <div class="wf-ai-icon">
          ${sc.cardClass === 'danger'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            : sc.cardClass === 'silent'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.8.6 1 1.6 1 2.3v1h6v-1c0-.7.2-1.7 1-2.3A7 7 0 0 0 12 2z"/></svg>'
          }
        </div>
        <div class="wf-ai-title">AI 资金建议</div>
        <div class="wf-ai-close" onclick="closeAiCard()">×</div>
      </div>

      <div class="wf-ai-purpose">
        <span class="wf-ai-purpose-label">预计用途：</span>
        <span class="wf-ai-purpose-value">${sc.purposeLabel}</span>
        <div class="wf-purpose-dropdown">
          <span class="wf-ai-purpose-edit" onclick="togglePurposeMenu()">可修改 ▾</span>
          <div class="wf-purpose-menu" id="purpose-menu">
            ${['付供应商','保留外币付款','暂时不用','不确定'].map(name => `
              <div class="wf-purpose-option ${STATE.scenario===name?'active':''}" onclick="setScenario('${name}')">
                <span class="wf-purpose-option-radio"></span>
                <span>${name === '不确定' ? '不确定 / 额度不足' : name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="wf-ai-evidence">${evidence}</div>

      ${bodyHtml}

      <div class="wf-ai-actions">
        ${actionsHtml}
      </div>

      <div class="wf-ai-disclaimer">
        * 以上为基于 WorldFirst 内部账户与历史交易的辅助建议，不构成投资建议；金额数据由规则引擎从后台 API 计算，最终决策与执行请用户二次确认。
      </div>
    </div>
  `;
}

function expandAiCard() {
  STATE.expanded = true;
  renderAiCard();
}
function closeAiCard() {
  document.getElementById('ai-card-mount').innerHTML = '';
}
function togglePurposeMenu() {
  const m = document.getElementById('purpose-menu');
  if (m) m.classList.toggle('open');
}

// ============================================================
// 演示场景切换（顶部 demo helper + 卡片下拉）
// ============================================================
function setScenario(name) {
  STATE.scenario = name;
  STATE.expanded = (name !== '付供应商'); // 静默场景默认折叠（其实它没有展开态）
  if (name === '付供应商') STATE.expanded = false;
  // 同步 demo helper 高亮
  document.querySelectorAll('.wf-demo-helper button').forEach(b => {
    b.classList.toggle('active', b.dataset.scenario === name);
  });
  // 关闭下拉
  const m = document.getElementById('purpose-menu');
  if (m) m.classList.remove('open');

  // 「不确定 / 额度不足」场景默认放大金额，让额度问题更明显
  if (name === '不确定' && STATE.amount < 70000) {
    document.getElementById('amount-input').value = '80,000';
    STATE.amount = 80000;
    syncOutput();
  }
  renderAiCard();
}

// ============================================================
// 兑换页交互
// ============================================================
function syncOutput() {
  const out = document.getElementById('amount-output');
  const btn = document.getElementById('confirm-btn');
  if (STATE.amount > 0) {
    out.value = '≈ ' + (STATE.amount * STATE.refRate).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    btn.disabled = false;
  } else {
    out.value = '';
    btn.disabled = true;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('amount-input');
  let blurTimer;
  input.addEventListener('input', e => {
    const v = e.target.value.replace(/[^0-9.]/g, '');
    const num = parseFloat(v) || 0;
    STATE.amount = num;
    // 简单千分位
    if (num) e.target.value = num.toLocaleString();
    syncOutput();
  });
  input.addEventListener('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      renderAiCard();
    }, 600);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  });

  // Demo 默认演示：自动填一个 50,000 触发主场景
  // 不填，让面试时手动输入更有「现场感」
  // 但加一个快捷：双击 amount input 直接填 50000
  input.addEventListener('dblclick', () => {
    input.value = '50,000';
    STATE.amount = 50000;
    syncOutput();
    setTimeout(renderAiCard, 200);
  });

  // 点击空白关闭 purpose 下拉
  document.addEventListener('click', e => {
    if (!e.target.closest('.wf-purpose-dropdown')) {
      const m = document.getElementById('purpose-menu');
      if (m) m.classList.remove('open');
    }
  });
});

// ============================================================
// 操作回调
// ============================================================
function applyMainSuggestion() {
  // 把金额改成"建议兑换部分"，并显示路径成本对比 toast
  const reserve = 30000;
  const convert = Math.max(STATE.amount - reserve, 0);
  document.getElementById('amount-input').value = convert.toLocaleString();
  STATE.amount = convert;
  syncOutput();
  showSavedBanner();
  showToast(`已应用：兑换 ${convert.toLocaleString()} USD + 保留 ${reserve.toLocaleString()} USD + 设置 USD/CNH 汇率提醒（7.05）`);
  closeAiCard();
}

function applyHalfConvert() {
  const half = Math.round(STATE.amount / 2 / 1000) * 1000;
  document.getElementById('amount-input').value = half.toLocaleString();
  STATE.amount = half;
  syncOutput();
  showToast(`已应用：分批兑换，先兑 ${half.toLocaleString()} USD，剩余等待明确用途`);
  closeAiCard();
}

function applyPartialByQuota() {
  const max = Math.floor(USER_PROFILE.fxQuotaCny / STATE.refRate);
  document.getElementById('amount-input').value = max.toLocaleString();
  STATE.amount = max;
  syncOutput();
  showToast(`已应用：按当前可结汇额度兑换 ${max.toLocaleString()} USD`);
  closeAiCard();
}

function setRateAlert() {
  showToast('已设置：USD/CNH 汇率提醒（目标 7.05），到达后通知你');
}
function continueOriginal() {
  showToast('已保留原方案：将兑换 ' + STATE.amount.toLocaleString() + ' USD');
  closeAiCard();
}
function cancelExchange() {
  showToast('已取消本次兑换，外币余额保持不变');
  closeAiCard();
}
function goQuotaPage() {
  showToast('跳转「店铺管理 → 额度管理」（演示页面，已记录跳转事件）');
}
function showMissingList() {
  showToast(`缺失凭证 ${USER_PROFILE.missingProofs} 笔：① 物流单 #TS-202604-0019 ② 物流单 #SP-202605-0033 ③ 商品发票 #INV-04412`);
}

function showSavedBanner() {
  const b = document.getElementById('saved-banner');
  if (b) b.classList.add('show');
}

function showToast(text) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span class="check">✓</span><span>${text}</span>`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

// ============================================================
// 追问对话（接 DeepSeek API via /api/chat）
// ============================================================
const FALLBACK_REPLIES = {
  '为什么保留 30,000 美元？': `30,000 美元是依据你近 30 天 USD 付款总额（约 $32,000）和频次推算的下月需求估算。\n\n如果你确认未来 1 个月不会再有 USD 支出（比如广告投放计划取消），可以告诉我，我重新算一份方案。`,
  '二次换汇成本怎么算？': `二次换汇成本来自两段：\n① USD → CNH 卖出点差：约 0.2-0.3%\n② 后续 CNH → USD 买入点差：约 0.2-0.3%\n\n按 30,000 USD 来回算，预计成本 ¥800-1,200，仅做参考。`,
  '如果广告投放计划取消怎么办？': `如果计划取消、未来确认无 USD 支出，可以选择：\n① 一次性全额兑换\n② 仍分批，但比例改为 80%/20%\n\n要我帮你重新生成一份"全额兑换"的方案吗？`,
  '为什么不全部换？': `全部兑换的风险是：\n① 你下月仍有 USD 支出，要再次买回美元（产生二次换汇成本）\n② 当前 USD/CNH 处于近 30 天偏高区间（不预测走势，仅作背景）\n\n所以建议先兑换覆盖近期 RMB 需求的部分，剩余等明确用途再决定。`,
  '凭证补传需要什么材料？': `根据展业三原则要求，每笔订单需要：\n① 物流单据（运单号、发货地址、收货地址）\n② 商品发票（含 SKU、单价、数量）\n③ 平台订单截图（订单号、买家、金额）\n\n通常补齐后 1-2 个工作日恢复结汇额度。`,
};

const SCENARIO_CHIPS = {
  '保留外币付款': ['为什么保留 30,000 美元？', '二次换汇成本怎么算？', '如果广告投放计划取消怎么办？'],
  '付供应商': ['本次额度还能换多少？', '历史最大供应商付款是多少？', '可以分批兑换吗？'],
  '暂时不用': ['为什么不建议立即全换？', '万余盈和分批兑换有什么区别？', '汇率提醒怎么设置？'],
  '不确定': ['凭证补传需要什么材料？', '什么是展业三原则？', '为什么 CNH 比 CNY 便宜？'],
};

function buildChatContext() {
  const sc = SCENARIOS[STATE.scenario];
  const amount = STATE.amount || 50000;
  return {
    场景: STATE.scenario,
    金额: `${amount.toLocaleString()} USD → CNH`,
    建议: sc.purposeLabel,
    依据摘要: sc.evidenceFn(amount).replace(/<[^>]+>/g, '').replace(/\n/g, ' '),
    用户画像: USER_PROFILE.business + '，月 GMV 约 50 万美元',
  };
}

function openChat() {
  const drawer = document.getElementById('chat-drawer');
  const mask = document.getElementById('chat-mask');
  drawer.classList.add('open');
  mask.classList.add('open');
  // 设置上下文
  const ctx = buildChatContext();
  document.getElementById('chat-context').innerHTML =
    `<strong>AI 已了解当前情境：</strong>${ctx.场景} · ${ctx.金额} · 建议「${ctx.建议}」`;
  // 重置历史
  STATE.chatHistory = [];
  renderChatBody();
  // 渲染 chips
  renderChatSuggestions();
}

function closeChat() {
  document.getElementById('chat-drawer').classList.remove('open');
  document.getElementById('chat-mask').classList.remove('open');
}

function renderChatSuggestions() {
  const wrap = document.getElementById('chat-suggestions');
  if (STATE.chatHistory.length > 0) { wrap.innerHTML = ''; return; }
  const chips = SCENARIO_CHIPS[STATE.scenario] || [];
  wrap.innerHTML = `
    <div class="wf-chat-suggestion-label">常见问题：</div>
    ${chips.map(c => `<button class="wf-chat-chip" onclick="askChip('${c.replace(/'/g, "\\'")}')">${c}</button>`).join('')}
  `;
}

function renderChatBody() {
  const body = document.getElementById('chat-body');
  body.innerHTML = STATE.chatHistory.map(msg => `
    <div class="wf-chat-msg ${msg.role}">
      ${msg.role === 'assistant' ? '<div class="wf-chat-author">AI 资金助手</div>' : ''}
      <div class="wf-chat-bubble">${escapeHtml(msg.content)}</div>
    </div>
  `).join('');
  body.scrollTop = body.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

function askChip(text) {
  document.getElementById('chat-input').value = text;
  sendChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  STATE.chatHistory.push({ role: 'user', content: text });
  renderChatBody();
  document.getElementById('chat-suggestions').innerHTML = '';

  // loading
  STATE.chatHistory.push({ role: 'assistant', content: '__loading__' });
  renderChatBodyWithLoading();

  try {
    const ctx = buildChatContext();
    const reply = await callChatApi(text, ctx);
    STATE.chatHistory.pop();
    STATE.chatHistory.push({ role: 'assistant', content: reply });
    renderChatBody();
  } catch (e) {
    // fallback
    STATE.chatHistory.pop();
    const fb = FALLBACK_REPLIES[text] || '抱歉，我暂时没法回答这个问题。建议联系你的客户经理获取更准确的信息。';
    STATE.chatHistory.push({ role: 'assistant', content: fb + '\n\n（提示：本次回答来自本地兜底，未连接 AI 服务）' });
    renderChatBody();
  }
}

function renderChatBodyWithLoading() {
  const body = document.getElementById('chat-body');
  body.innerHTML = STATE.chatHistory.map(msg => {
    if (msg.content === '__loading__') {
      return `<div class="wf-chat-msg assistant">
        <div class="wf-chat-author">AI 资金助手</div>
        <div class="wf-chat-bubble"><div class="wf-chat-loading"><span></span><span></span><span></span></div></div>
      </div>`;
    }
    return `<div class="wf-chat-msg ${msg.role}">
      ${msg.role === 'assistant' ? '<div class="wf-chat-author">AI 资金助手</div>' : ''}
      <div class="wf-chat-bubble">${escapeHtml(msg.content)}</div>
    </div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

function onChatKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

async function callChatApi(userMsg, ctx) {
  // 优先调本地 proxy（/api/chat），失败抛错由调用方 fallback
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: ctx,
      message: userMsg,
      history: STATE.chatHistory
        .filter(m => m.content !== '__loading__')
        .slice(0, -1) // 不包含当前正在请求的 assistant 占位
        .map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error('api error: ' + res.status);
  const data = await res.json();
  if (!data.reply) throw new Error('empty reply');
  return data.reply;
}
