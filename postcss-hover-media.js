import postcss from 'postcss'

const DESKTOP_HOVER_MEDIA = '(hover: hover) and (pointer: fine)'

// Tailwind генерує hover-правила окремими CSS-селекторами. Переносимо їх у
// desktop-only media query, щоб touch-браузери та phone emulation не могли
// залишити :hover активним після натискання.
export default function hoverMedia() {
  return {
    postcssPlugin: 'postcss-hover-media',
    Once(root) {
      const hoverRules = []
      root.walkRules(rule => {
        if (rule.selector?.includes(':hover')) hoverRules.push(rule)
      })

      hoverRules.forEach(rule => {
        const media = postcss.atRule({ name: 'media', params: DESKTOP_HOVER_MEDIA })
        rule.replaceWith(media)
        media.append(rule)
      })
    },
  }
}

hoverMedia.postcss = true
