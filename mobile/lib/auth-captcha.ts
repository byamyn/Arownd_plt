type AuthCaptchaHandler = () => Promise<string>;

let handler: AuthCaptchaHandler | null = null;

export function registerAuthCaptchaHandler(nextHandler: AuthCaptchaHandler): () => void {
  handler = nextHandler;

  return () => {
    if (handler === nextHandler) handler = null;
  };
}

export function requestAuthCaptchaToken(): Promise<string> {
  if (!handler) {
    return Promise.reject(new Error("AUTH_CAPTCHA_UNAVAILABLE"));
  }

  return handler();
}
