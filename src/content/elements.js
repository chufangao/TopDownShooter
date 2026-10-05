// affinity[defender element] on the attacking element; unlisted matchups are 1.
export default [
  { id: 'physical', name: 'Physical', tint: '#d8d4cc', affinity: {} },
  { id: 'fire', name: 'Fire', tint: '#ff7a33', affinity: { frost: 1.5, fire: 0.5 } },
  { id: 'frost', name: 'Frost', tint: '#66c8ff', affinity: { arcane: 1.5, frost: 0.5 } },
  { id: 'arcane', name: 'Arcane', tint: '#b57bff', affinity: { fire: 1.5, arcane: 0.5 } },
  { id: 'dark', name: 'Dark', tint: '#7a5c9e', affinity: { holy: 1.5, dark: 0.5 } },
  { id: 'holy', name: 'Holy', tint: '#ffe9a8', affinity: { dark: 2, holy: 0.5 } }
]
