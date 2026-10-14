(() => {
  const LS = 'ts_ui_density';
  const body = document.body;
  const compact = () => body.classList.toggle('ui-compact', localStorage.getItem(LS) !== 'comfort');
  const add = (select, value, text = value) => {
    if (!select || [...select.options].some(o => o.value === value || o.textContent === text)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  };
  const enhanceSelects = () => {
    const inviteDays = document.querySelector('form[data-form="create-invite"] select[name="days"]');
    [['3','3 jours'],['5','5 jours'],['21','21 jours']].forEach(([v,t]) => add(inviteDays, v, t));
    const verdict = document.querySelector('form[data-form="judgment"] select[name="verdict"]');
    ['Instruction','En audience','Classé sans suite','En appel','Sanction appliquée','Amende payée','Dossier archivé'].forEach(v => add(verdict, v));
    const task = document.querySelector('form[data-form="task"] select[name="type"]');
    ['Audience','Convocation','Plainte','Enquête','Mandat','Trésorerie','Archivage','Visite prison','Suivi détenu','Rapport Kensatsu','Autre'].forEach(v => add(task, v));
  };
  const injectDensity = () => {
    const zones = [document.querySelector('.head-actions'), document.querySelector('.profile-card')].filter(Boolean);
    zones.forEach(zone => {
      if (zone.querySelector('.ui-density')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = zone.classList.contains('head-actions') ? 'ghost small ui-density' : 'ghost wide ui-density';
      btn.textContent = body.classList.contains('ui-compact') ? 'Mode confort' : 'Mode compact';
      btn.addEventListener('click', () => {
        const next = body.classList.contains('ui-compact') ? 'comfort' : 'compact';
        localStorage.setItem(LS, next);
        compact();
        document.querySelectorAll('.ui-density').forEach(x => x.textContent = body.classList.contains('ui-compact') ? 'Mode confort' : 'Mode compact');
      });
      zone.prepend(btn);
    });
  };
  const injectSearch = () => {
    document.querySelectorAll('.card').forEach(card => {
      const list = card.querySelector(':scope > .list');
      if (!list || card.querySelector(':scope > .ui-search')) return;
      const input = document.createElement('input');
      input.className = 'ui-search';
      input.placeholder = 'Rechercher dans cette liste…';
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        list.querySelectorAll('.row-item').forEach(row => row.classList.toggle('ui-hidden', q && !row.textContent.toLowerCase().includes(q)));
      });
      list.before(input);
    });
  };
  const run = () => { compact(); enhanceSelects(); injectDensity(); injectSearch(); };
  new MutationObserver(run).observe(document.getElementById('app'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('DOMContentLoaded', run);
  setInterval(run, 1200);
})();
