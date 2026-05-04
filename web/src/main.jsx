import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex h-screen w-screen items-center justify-center overflow-hidden bg-[#ebe7dc] text-[#141511]">
          <section className="w-[28rem] rounded-md border border-zinc-300 bg-[#fbfaf5] p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Teamflow Desktop 启动失败</h1>
            <p className="mt-2 text-sm text-zinc-600">界面渲染时出错了，刷新后通常可以恢复。</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              刷新
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <RootErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </RootErrorBoundary>,
);
