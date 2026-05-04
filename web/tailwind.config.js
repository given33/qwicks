/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101418",
        paper: "#f6f1e8",
        steel: "#26323b",
        line: "#c8bda6",
        amber: "#e0a526",
        signal: "#1f8a70",
        fault: "#b3404a",
      },
      fontFamily: {
        display: ["Georgia", "Noto Serif SC", "serif"],
        body: ["Bahnschrift", "Microsoft YaHei UI", "sans-serif"],
        mono: ["Cascadia Mono", "Consolas", "monospace"],
      },
      boxShadow: {
        board: "0 24px 70px rgba(16, 20, 24, 0.18)",
      },
    },
  },
  plugins: [],
};
