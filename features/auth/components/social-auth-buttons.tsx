"use client";

import { Button } from "@/components/button";
import { IconBrandGoogle, IconBrandGithub } from "@tabler/icons-react";
import { useTranslations } from 'next-intl';

interface SocialAuthButtonsProps {
  onGoogleSignIn?: () => Promise<void> | void;
  onGitHubSignIn?: () => Promise<void> | void;
  isLoading?: boolean;
}

export function SocialAuthButtons({
  onGoogleSignIn,
  onGitHubSignIn,
  isLoading,
}: SocialAuthButtonsProps) {
  const t = useTranslations('auth.social');
  return (
    <div className="flex flex-col gap-3">
      {onGoogleSignIn && <Button
        onClick={onGoogleSignIn}
        className="w-full py-1.5"
        variant="outline"
        disabled={isLoading}
        type="button"
      >
        <IconBrandGoogle className="h-5 w-5" />
        <span className="text-sm font-semibold leading-6">{t('googleSignIn')}</span>
      </Button>}
      {onGitHubSignIn && <Button
        onClick={onGitHubSignIn}
        className="w-full py-1.5"
        variant="outline"
        disabled={isLoading}
        type="button"
      >
        <IconBrandGithub className="h-5 w-5" />
        <span className="text-sm font-semibold leading-6">{t('githubSignIn')}</span>
      </Button>}
    </div>
  );
}
