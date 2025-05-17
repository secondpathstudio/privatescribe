/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
      "./index.html", "./src/**/*.{ts,tsx,js,jsx,mdx}",
    ],
    theme: {
      extend: {
        colors: {
          neo: {
          'dark-purple': "#2b0f54",
          'purple': "#5d1d91",
          'pink': "#ff00ff",
          'hot-pink': "#fd3777",
          'bright-pink': "#fe4164",
          'orange': "#ff9900",
          'yellow': "#ffff00",
          'cyan': "#00ffff"
        }
      }
    },
  },
    plugins: [
      require("tailwindcss-animate"),
      require('@tailwindcss/typography')
    ],
  }
  