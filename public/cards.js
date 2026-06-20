/* ═══════════════════════════════════════════════════════════
   UNO Card Renderer — CSS-based card generation
   ═══════════════════════════════════════════════════════════ */

const CardRenderer = (() => {

  const SYMBOLS = {
    skip:    '⊘',
    reverse: '⟲',
    draw2:   '+2',
    wild:    '',
    wild4:   '+4'
  };

  const LABELS = {
    skip:    'SKIP',
    reverse: 'REV',
    draw2:   '+2',
    wild:    'WILD',
    wild4:   '+4'
  };

  const AVATAR_COLORS = [
    '#EF4444', '#3B82F6', '#22C55E', '#EAB308',
    '#A855F7', '#EC4899', '#F97316', '#06B6D4'
  ];

  /**
   * Create a card DOM element
   * @param {Object} card  { id, color, value, type }
   * @param {Object} opts  { playable, onClick, small }
   */
  function createCard(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'uno-card';
    el.dataset.cardId = card.id;

    // Color class
    if (card.color) {
      el.classList.add(`card-${card.color}`);
    } else {
      el.classList.add('card-wild');
    }

    // Playable state
    if (opts.playable === false) {
      el.classList.add('not-playable');
    }

    // Click handler
    if (opts.onClick) {
      el.addEventListener('click', () => opts.onClick(card));
    }

    // Build face
    const face = document.createElement('div');
    face.className = 'card-face';

    // Inner oval
    const oval = document.createElement('div');
    oval.className = 'card-oval';
    face.appendChild(oval);

    if (card.type === 'number') {
      // Number card
      const val = document.createElement('div');
      val.className = 'card-value';
      val.textContent = card.value;
      face.appendChild(val);

      addCorners(face, String(card.value));

    } else if (card.type === 'wild' || card.type === 'wild4') {
      // Wild card
      const diamond = document.createElement('div');
      diamond.className = 'wild-diamond';
      for (let i = 0; i < 4; i++) {
        const q = document.createElement('div');
        q.className = 'wild-q';
        diamond.appendChild(q);
      }
      face.appendChild(diamond);

      const label = document.createElement('div');
      label.className = 'wild-label';
      label.textContent = card.type === 'wild4' ? '+4' : 'WILD';
      face.appendChild(label);

      // Corners
      const cornerText = card.type === 'wild4' ? '+4' : '✦';
      addCorners(face, cornerText);

    } else {
      // Action card (skip, reverse, draw2)
      const sym = document.createElement('div');
      sym.className = 'card-value card-symbol';
      sym.textContent = SYMBOLS[card.type] || '?';
      face.appendChild(sym);

      addCorners(face, LABELS[card.type] || '');
    }

    el.appendChild(face);
    return el;
  }

  function addCorners(face, text) {
    const tl = document.createElement('div');
    tl.className = 'card-corner card-corner-tl';
    tl.textContent = text;
    face.appendChild(tl);

    const br = document.createElement('div');
    br.className = 'card-corner card-corner-br';
    br.textContent = text;
    face.appendChild(br);
  }

  /**
   * Create a card-back element
   */
  function createCardBack() {
    const el = document.createElement('div');
    el.className = 'card-back';
    const inner = document.createElement('div');
    inner.className = 'card-back-inner';
    inner.textContent = 'UNO';
    el.appendChild(inner);
    return el;
  }

  /**
   * Get an avatar color for a player index
   */
  function getAvatarColor(index) {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  /**
   * Get initials from a name
   */
  function getInitials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  return { createCard, createCardBack, getAvatarColor, getInitials };
})();
