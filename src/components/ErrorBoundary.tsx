import { Component, type ReactNode, type ErrorInfo } from "react";
import { IconAlertCircle } from "./Icons";

/** React error boundary — tangkap render errors, tampilkan pesan yang dapat dibaca user */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error("AzaleaHouse error boundary:", error);
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="error-boundary" role="alert">
          <IconAlertCircle size={24} />
          <h2>Terjadi kesalahan</h2>
          <p>{this.state.message}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              this.setState({ hasError: false, message: "" });
              window.location.reload();
            }}
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
