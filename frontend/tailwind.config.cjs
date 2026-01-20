// tailwind.config.cjs
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 背景（黒を廃止）
        'snack-bg': '#1c140e',
        'snack-bg-soft': '#241a12',
        'snack-wall': '#0f1f1a',
        'snack-panel': '#2a1f16',

        // 文字
        'snack-text': '#e8dccf',
        'snack-text-dim': '#c8b8a8',

        // ネオン
        'snack-neon-pink': '#ff5a78',
        'snack-neon-blue': '#4db8ff',
      },
      boxShadow: {
        'neon-pink':
          '0 0 6px rgba(255,90,120,.5), 0 0 14px rgba(255,90,120,.25)',
        'neon-blue':
          '0 0 6px rgba(77,184,255,.45), 0 0 14px rgba(77,184,255,.25)',
      },
      backgroundImage: {
        'counter-pattern': "url('/assets/wood-grain.png')",
        'noise': "url('/assets/noise.png')",
      },
      fontFamily: {
        snack: ['"Shippori Mincho B1"', 'serif'],
        snackTitle: ['"Yuji Mai"', 'cursive'],
      },
      animation: {
        fadeIn: 'fadeIn .6s ease-out both',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
