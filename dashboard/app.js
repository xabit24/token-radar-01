// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs, the live-token comparables and the protocol's farm plan. No network: every byte it
// shows is in data.js.
//
// The model, in one function (see lib/model.ts, impliedValue): the page recomputes a row from the
// snapshot figures and checks the number board.json carries, so the page's code and the board's
// data are visibly the same arithmetic. The size multiple is tiered by TVL on a log scale,
// 0.40x for the smallest down to 0.15x for the largest, fitted from the snapshot's own
// live-token protocols; the category factor is the category's comparable multiple: the median
// market-cap-to-TVL of the live-token protocols in that category, divided by the same median
// across all live-token protocols, clamped to [0.5, 2.0]; a category with fewer than 3 live
// comparables uses 1.0.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, minTvl: 0, watchlistOnly: false, sandbox: { sizeScale: 1, growthWeight: null, maturityRange: null } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(2) + 'x'; }
  // The fitted size multiple for a TVL: the first tier whose cap the TVL sits below.
  function sizeMultipleOf(tvl, model) {
    var tiers = model.size_tiers || [];
    for (var i = 0; i < tiers.length; i++) {
      if (tvl < tiers[i].max_tvl_usd) return tiers[i].multiple;
    }
    return tiers.length ? tiers[tiers.length - 1].multiple : 0.25;
  }
  // The model in one function: TVL x fitted size multiple x category factor x growth x maturity.
  // The sandbox scales the size multiple and overrides the growth and maturity weights.
  function impliedOf(row, model) {
    var m = model;
    var growthWeight = state.sandbox.growthWeight === null ? m.growth_weight : state.sandbox.growthWeight;
    var maturityRange = state.sandbox.maturityRange === null ? m.maturity_range : state.sandbox.maturityRange;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * growthWeight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * maturityRange;
    var factor = row.category_factor === null || row.category_factor === undefined ? 1 : row.category_factor;
    var sizeMult = sizeMultipleOf(row.tvl_usd, m) * state.sandbox.sizeScale;
    return Math.max(1, Math.round(row.tvl_usd * sizeMult * factor * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the second action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return { setup: 12, weekly: 3, first: 15 };
    return { setup: 3, weekly: 1, first: 3 };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('cdp') >= 0) return 'Lock $' + capital + ' of collateral on ' + name + ' and mint the stable asset against it, keeping the position over-collateralised.';
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('payments') >= 0 || c.indexOf('payment') >= 0) return "Open a payment channel on " + name + " with $" + capital + " of the chain's native asset and route one payment through it.";
    if (c === 'chain') return 'Bridge $' + capital + ' of assets to ' + name + ' and use one dApp on the chain, so the wallet is active there.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('cdp') >= 0) return 'Borrow a small amount of the stable asset against the collateral on ' + name + ', so both sides of the position are active on the same wallet.';
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ', so both sides of the market are active on the same wallet.';
    if (c.indexOf('payments') >= 0 || c.indexOf('payment') >= 0) return 'Route a second, smaller payment through ' + name + ' a week later, so the channel is used more than once.';
    if (c === 'chain') return 'Use a second dApp on ' + name + ", or stake a small amount of the chain's native asset, so the wallet is not a one-off bridge.";
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Swap a small amount through " + name + "'s pool once a week, so the position is not idle.";
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + name + ' a week later, so the route is used more than once.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the receipt token once, if ' + name + ' offers it, to show continued use.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge after a week and open a fresh one, keeping the margin in place on ' + name + '.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market on ' + name + ' and place a second small position.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit into a second ' + name + ' vault, or vote on a curator proposal if one is open.';
    if (c.indexOf('stable') >= 0) return 'Hold the stable asset through a full weekly cycle on ' + name + ' and use it in one transfer.';
    if (c.indexOf('rwa') >= 0) return 'Claim any yield distribution from ' + name + ' once, and keep the principal in the position.';
    if (c.indexOf('insurance') >= 0) return 'Renew or top up the cover from ' + name + ' once before it lapses.';
    return 'Make a second, different action on ' + name + ' — a swap, a vote or a deposit — so the wallet is not a single-transaction farmer.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $' + gas.first + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas.setup + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + gas.weekly + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  /** The live-token comparables for one category, by market cap: what the category factor is built from. */
  function comparablesFor(category) {
    return DATA.live.filter(function (r) { return r.category === category; }).slice(0, 3);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    var watchlist = {};
    DATA.ledger.forEach(function (e) { if (e.status === 'watchlist') watchlist[e.slug] = true; });
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.watchlistOnly && !watchlist[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'expected') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function totalImplied() { return DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0); }
  function medianImplied() {
    var vs = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var mid = vs.length >> 1;
    return vs.length % 2 ? vs[mid] : (vs[mid - 1] + vs[mid]) / 2;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { html: '<b>' + DATA.model_version + '</b> model' })
      )
    );
  }

  function totalExpected() { return DATA.rows.reduce(function (n, r) { return n + r.expected_value_usd; }, 0); }
  function oddsOver50() { return DATA.rows.filter(function (r) { return r.launch_odds > 0.5; }).length; }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record</b>. The early radar adds ' + DATA.early_size + ' more pre-token protocols — every one that passes the watchlist\u2019s own exclusions, with no size ceiling, so a large pre-token protocol is a launch candidate too. Implied value is a model, not a promise; expected value is the implied value times the launch odds.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token rows set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { class: 'amber', text: fmtUsd(totalImplied()) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total expected value' }), el('b', { class: 'amber', text: fmtUsd(totalExpected()) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(medianImplied()) })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows with launch odds over 50%' }), el('b', { text: String(oddsOver50()) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'min-tvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      [5e6, 10e6, 50e6, 100e6].map(function (v) {
        return el('option', { value: String(v), text: 'TVL over $' + Math.round(v / 1e6) + 'M', selected: state.minTvl === v ? 'selected' : null });
      })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); writeHash(); render(); });
    var watchOnly = el('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var ledger = el('button', { type: 'button', 'aria-pressed': state.tab === 'ledger' ? 'true' : 'false', text: 'Ledger', onclick: function () { state.tab = 'ledger'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'Minimum TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchOnly),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, ledger)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : (DATA.ledger ? DATA.ledger.length : 0) + ' protocols in the ledger' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' + (r.rank <= 3 ? ' rank-top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.expected_value_usd) }),
        el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }),
        el('td', null, el('span', { class: 'verdict ' + r.farm_verdict.toLowerCase(), text: r.farm_verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Expected value is the implied value times the launch odds. Select a row for its model, its live-token comparables and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('expected', 'Expected value'),
            sortHeader('odds', 'Launch odds'),
            el('th', { scope: 'col', text: 'Farm verdict' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.mcap_tvl) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model — and their market-cap-to-TVL ratios are what the category factors are built from. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function categoryBars() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = { total: 0, count: 0 };
      byCat[c].total += r.implied_value_usd;
      byCat[c].count += 1;
    });
    var cats = Object.keys(byCat).map(function (c) { return { name: c, total: byCat[c].total, count: byCat[c].count }; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    var max = cats.length ? cats[0].total : 1;
    return el('section', { class: 'panel catbars' },
      el('h2', { text: 'Where the implied value sits, by category' }),
      el('p', { class: 'sub', text: 'Total implied value of the ranked protocols in each category. Risk curators and capital allocators dominate because the largest pre-token protocols live there.' }),
      cats.map(function (c) {
        return el('div', { class: 'catbar' },
          el('span', { class: 'cat', text: c.name }),
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((c.total / max) * 100)) + '%' })),
          el('span', { class: 'val', text: fmtUsd(c.total) + ' · ' + c.count + ' rows' })
        );
      })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var factors = Object.keys(DATA.category_factors || {}).map(function (c) {
      var f = DATA.category_factors[c];
      return { name: c, factor: f.factor, median: f.median_mcap_tvl, comps: f.comps };
    }).filter(function (f) { return f.comps >= m.category_min_comps; }).sort(function (a, b) { return b.factor - a.factor; });
    var rows = factors.map(function (f) {
      return el('tr', null,
        el('td', { text: f.name }),
        el('td', { class: 'num', text: String(f.comps) }),
        el('td', { class: 'num', text: fmtMult(f.median) }),
        el('td', { class: 'num', text: fmtMult(f.factor) })
      );
    });
    var tierRows = (m.size_tiers || []).map(function (t, i) {
      var label = i === 0 ? 'under $10M' : i === m.size_tiers.length - 1 ? '$1B and over' : '$' + (m.size_tiers[i - 1].max_tvl_usd / 1e6) + 'M to $' + (t.max_tvl_usd / 1e6) + 'M';
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num', text: fmtMult(t.multiple) })
      );
    });
    var v = DATA.validation || null;
    var validationNote = v
      ? 'Blind test (leave-one-out over the ' + v.test_size + ' live-token protocols: each protocol\u2019s market cap is predicted from a model fit on all the others, category factors refit without it). Median absolute log error ' + v.median_abs_log_error + ' vs ' + v.flat_baseline_median_abs_log_error + ' for a flat 0.25x baseline, rank correlation ' + v.spearman_rank_correlation + ' vs ' + v.flat_baseline_spearman_rank_correlation + '. On the largest TVL quintile, where the size curve matters most, the error is ' + v.top_quintile_median_abs_log_error + ' vs ' + v.flat_baseline_top_quintile_median_abs_log_error + ' — the size curve keeps the largest protocols from being overvalued. The absolute error is still large (a typical prediction is off by a factor of e^' + v.median_abs_log_error + '), so the ranking is a signal, not a valuation.'
      : 'No validation data is bundled with this build.';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'size multiple (by TVL)' }), ' x category factor x (1 + clamp(change_7d, ', String(m.growth_floor), ', ', String(m.growth_cap), ') / 100 x ', String(m.growth_weight), ') x (', String(m.maturity_floor), ' + min(age_days, ', String(m.maturity_days), ') / ', String(m.maturity_days), ' x ', String(m.maturity_range), ') )'
      ),
      el('p', { class: 'note', html: 'The <b>size multiple</b> is fitted from the snapshot\u2019s own live-token protocols: their market-cap-to-TVL ratio falls as TVL grows (the smallest quintile\u2019s median is 0.888x, the largest\u2019s is 0.048x), so a flat 0.25x would overvalue the largest protocols by roughly ten times. The tiers below follow that shape, smoothed and floored so the largest protocols keep a 0.15x multiple — the top tiers rest on only a few live comparables, so they are not driven to the raw tier medians. The <b>category factor</b> is the category\u2019s comparable multiple: the median market-cap-to-TVL of the protocols in that category that already trade, divided by the same median across all ' + DATA.live_size + ' live-token protocols in this snapshot (the global median is <b>' + DATA.global_median_mcap_tvl + 'x</b>), clamped to [' + m.category_factor_floor + ', ' + m.category_factor_cap + ']. A category with fewer than ' + m.category_min_comps + ' live comparables uses 1.0 rather than a noisy median.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The fitted size curve: the market-cap-to-TVL multiple falls as TVL grows.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Size multiple' }))),
          el('tbody', null, tierRows)
        )
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Categories with at least ' + m.category_min_comps + ' live comparables, strongest factor first.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Factor' }))),
          el('tbody', null, rows)
        )
      ),
      el('h3', { text: 'Launch odds and expected value' }),
      el('p', { class: 'note', html: 'Each row also carries <b>launch odds</b>: the chance it ever launches a token, from the snapshot alone. It starts from the category\u2019s own share of live-token protocols (Laplace-smoothed), falls as the protocol ages with no token (halving each year), and rises with seven-day growth. Chains and payment infrastructure are capped at 5% — a chain or a payment rail is structurally unlikely to launch a token. <b>Expected value</b> is the implied value times the launch odds. ' + DATA.rows.filter(function (r) { return r.launch_odds > 0.5; }).length + ' of ' + DATA.board_size + ' rows have odds over 50%.' }),
      el('h3', { text: 'Does the size curve earn its place?' }),
      el('p', { class: 'note', text: validationNote }),
      el('p', { class: 'note', html: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Seven-day growth is clamped because one protocol in this snapshot moved +4,448% in a week, and a single week should not decide a ranking. The early radar is every pre-token protocol that passes the watchlist\u2019s own exclusions, with no size ceiling, and the live-token protocols are set aside with their market caps shown.' }),
      el('p', { class: 'note', html: '<b>What \u201cno token\u201d means:</b> the protocol records no token in DefiLlama\u2019s index — no market cap, no CoinGecko id, no symbol. That is a record, not proof: a protocol may have a token DefiLlama does not list, and a token launch is never guaranteed. The implied value is this entry\u2019s own estimate, never a price.' })
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    var sizeScale = el('input', { type: 'range', id: 'sb-size', min: '0.5', max: '2', step: '0.05', value: String(state.sandbox.sizeScale) });
    var growthW = el('input', { type: 'range', id: 'sb-growth', min: '0', max: '1', step: '0.05', value: String(state.sandbox.growthWeight === null ? m.growth_weight : state.sandbox.growthWeight) });
    var maturityR = el('input', { type: 'range', id: 'sb-maturity', min: '0', max: '0.8', step: '0.05', value: String(state.sandbox.maturityRange === null ? m.maturity_range : state.sandbox.maturityRange) });
    var sizeVal = el('b', { text: state.sandbox.sizeScale.toFixed(2) + 'x' });
    var growthVal = el('b', { text: String(state.sandbox.growthWeight === null ? m.growth_weight : state.sandbox.growthWeight) });
    var maturityVal = el('b', { text: String(state.sandbox.maturityRange === null ? m.maturity_range : state.sandbox.maturityRange) });
    sizeScale.addEventListener('input', function () { state.sandbox.sizeScale = Number(sizeScale.value); sizeVal.textContent = state.sandbox.sizeScale.toFixed(2) + 'x'; render(); });
    growthW.addEventListener('input', function () { state.sandbox.growthWeight = Number(growthW.value); growthVal.textContent = String(state.sandbox.growthWeight); render(); });
    maturityR.addEventListener('input', function () { state.sandbox.maturityRange = Number(maturityR.value); maturityVal.textContent = String(state.sandbox.maturityRange); render(); });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the fitted model', onclick: function () { state.sandbox = { sizeScale: 1, growthWeight: null, maturityRange: null }; render(); } });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox — try the model yourself' }),
      el('p', { class: 'sub', text: 'Drag a slider and the board recomputes live from the same function. Nothing here changes board.json; it only shows how sensitive the ranking is to each term.' }),
      el('div', { class: 'sliders' },
        el('div', { class: 'slider' }, el('label', { for: 'sb-size', text: 'Size multiple scale' }), sizeScale, sizeVal),
        el('div', { class: 'slider' }, el('label', { for: 'sb-growth', text: 'Growth weight' }), growthW, growthVal),
        el('div', { class: 'slider' }, el('label', { for: 'sb-maturity', text: 'Maturity range' }), maturityR, maturityVal)
      ),
      el('p', { class: 'sub', text: 'Size scale multiplies every tier of the fitted size curve; growth weight is the 0.5 in (1 + growth / 100 x 0.5); maturity range is the 0.4 in (0.6 + age / 1095 x 0.4).' }),
      reset
    );
  }

  function ledgerTable() {
    var list = DATA.ledger || [];
    var q = state.q.trim().toLowerCase();
    var filtered = list.filter(function (e) {
      if (!q) return true;
      var hay = [e.name, e.slug, e.category, e.status, e.reason || ''].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var tbody = el('tbody');
    filtered.forEach(function (e) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: e.name }), el('span', { class: 'sub', text: e.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(e.tvl_usd) }),
        el('td', null, el('span', { class: 'status ' + (e.status === 'watchlist' ? 'watch' : e.status === 'pre-token' ? 'early' : e.status === 'live-token' ? 'live' : ''), text: e.status })),
        el('td', { class: 'sub', text: e.reason || '' })
      ));
    });
    var counts = list.reduce(function (acc, e) { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
    return el('div', { class: 'panel' },
      el('p', { class: 'sub', text: 'Every protocol in the snapshot, with its status. ' + (counts.watchlist || 0) + ' on the watchlist, ' + (counts['pre-token'] || 0) + ' pre-token and ranked, ' + (counts['live-token'] || 0) + ' live-token and set aside, ' + (counts.excluded || 0) + ' excluded with a reason. Showing ' + filtered.length + ' of ' + list.length + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Reason' }))),
          tbody
        )
      )
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('span', { html: 'Source: <b>' + DATA.source + '</b>' }),
      el('span', { html: 'Model <b>' + DATA.model_version + '</b> · board.json carries ' + DATA.board_size + ' rows · dashboard renders offline from data.js' }),
      el('span', { text: 'Built for make.fun token-radar-01. Implied values are estimates from the snapshot\u2019s own figures; farming any protocol carries smart-contract and market risk.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var comps = comparablesFor(row.category);
    var m = DATA.model;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size multiple (by TVL)' }), el('b', { class: 'num', text: fmtMult(row.size_multiple) })),
        el('div', null, el('span', { text: 'Category factor (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_factor) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        el('div', { class: 'total' }, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.expected_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: 'Launch odds start from the category\u2019s own share of live-token protocols, fall as the protocol ages with no token, and rise with seven-day growth. Chains and payment infrastructure are capped at 5% — they are structurally unlikely to launch a token. Expected value is the implied value times the launch odds.' })
    ));
    if (row.risk_notes && row.risk_notes.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Risk notes' }),
        el('ul', { class: 'risk' }, row.risk_notes.map(function (n) { return el('li', { text: n }); }))
      ));
    }
    if (comps.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live-token comparables in ' + (row.category || 'this category') }),
        el('p', { class: 'sub', text: 'Protocols in the same category that already trade — the category factor is their median market-cap-to-TVL against the global median of ' + DATA.global_median_mcap_tvl + 'x.' }),
        el('div', { class: 'comps' }, comps.map(function (c) {
          return el('div', null, el('span', { text: c.name }), el('b', { text: fmtMult(c.mcap_tvl) + ' mcap/TVL' }));
        }))
      ));
    }
    var verdict = row.farm_verdict || 'n/a';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', html: 'Verdict: <b>' + verdict + '</b> — ' + (verdict === 'Farm' ? 'the net is positive and the implied hourly rate clears $25 an hour.' : verdict === 'Thin' ? 'the net is positive but the implied hourly rate is below $25 an hour.' : 'the net is zero or negative; the farm costs more than it is expected to return.') }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Expected airdrop value' }), el('b', { class: 'num', text: row.farm_expected_airdrop_usd !== undefined ? '$' + row.farm_expected_airdrop_usd : 'n/a' })),
        el('div', null, el('span', { text: 'Farm cost (capital + gas + time)' }), el('b', { class: 'num', text: row.farm_cost_usd !== undefined ? '$' + row.farm_cost_usd : 'n/a' })),
        el('div', { class: 'total' }, el('span', { text: 'Net' }), el('b', { class: 'num', text: row.farm_net_usd !== undefined ? (row.farm_net_usd >= 0 ? '$' : '-$') + Math.abs(row.farm_net_usd) : 'n/a' })),
        el('div', null, el('span', { text: 'Implied hourly rate' }), el('b', { class: 'num', text: row.farm_hourly_usd !== undefined ? (row.farm_hourly_usd >= 0 ? '$' : '-$') + Math.abs(row.farm_hourly_usd) + ' / hour' : 'n/a' }))
      ),
      el('p', { class: 'sub', text: 'The expected airdrop is 5% of the expected value, split across an estimated farmer count (TVL / $100,000, clamped to 100–10,000 farmers). The farm cost is the capital, gas and the hours at $25 an hour. A large protocol with a low launch odds can still be a Skip even at the top of the board.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'ledger' ? ledgerTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(categoryBars());
      shell.appendChild(modelPanel());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
