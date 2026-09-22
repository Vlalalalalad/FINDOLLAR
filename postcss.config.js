import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import hoverMedia from './postcss-hover-media.js'

export default {
  plugins: [tailwindcss(), hoverMedia(), autoprefixer()],
}
