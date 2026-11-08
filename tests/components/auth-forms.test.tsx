import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signIn } from "@/lib/auth-client";
import messages from "@/messages/en.json";
import { LoginForm } from "@/features/auth/components/login-form";
import { SignupForm } from "@/features/auth/components/signup-form";

const routerPushMock = vi.fn();

function getNestedValue(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return (value as Record<string, unknown>)[key];
    }

    return undefined;
  }, source);
}

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace?: string) => {
    const root = namespace
      ? (getNestedValue(messages as Record<string, unknown>, namespace) as Record<string, unknown>)
      : (messages as Record<string, unknown>);

    return (path: string) => {
      const value = getNestedValue(root, path);

      if (typeof value !== "string") {
        throw new Error(`Missing translation for ${namespace ?? "root"}:${path}`);
      }

      return value;
    };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.PropsWithChildren<{ href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    email: vi.fn(),
    social: vi.fn(),
  },
  signUp: {
    email: vi.fn(),
  },
}));

describe("auth forms", () => {
  beforeEach(() => { vi.mocked(signIn.social).mockReset(); });

  it.each([LoginForm, SignupForm])("enables GitHub independently and sends the correct provider", async (Form) => {
    render(<Form showGoogleAuth={false} showGitHubAuth />);
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    await waitFor(() => expect(signIn.social).toHaveBeenCalledWith({ provider: "github", callbackURL: "/" }));
  });

  it("shows both providers and disables both during a pending request", async () => {
    vi.mocked(signIn.social).mockReturnValue(new Promise(() => {}));
    render(<LoginForm showGoogleAuth showGitHubAuth />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
  });

  it("shows a GitHub-specific error when OAuth returns an error", async () => {
    vi.mocked(signIn.social).mockResolvedValue({ data: null, error: { message: "denied", status: 400, statusText: "Bad Request" } });
    render(<LoginForm showGoogleAuth={false} showGitHubAuth />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByText("GitHub login failed. Please try again.")).toBeInTheDocument();
  });
  it("hides the Google button on login when Google auth is disabled", () => {
    render(<LoginForm showGoogleAuth={false} />);

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("hides the Google button on signup when Google auth is disabled", () => {
    render(<SignupForm showGoogleAuth={false} />);

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("still renders the Google button when Google auth is enabled", () => {
    render(<LoginForm showGoogleAuth />);

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });
});
