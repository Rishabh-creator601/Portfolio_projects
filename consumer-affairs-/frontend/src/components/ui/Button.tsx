'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-cyan-bright text-white border border-transparent shadow-cyan hover:bg-cyan-600 active:bg-cyan-700',
  secondary:
    'bg-white text-cyan-800 border border-cyan-300 hover:bg-cyan-50 hover:border-cyan-400 active:bg-cyan-100',
  subtle: 'bg-cyan-50 text-cyan-800 border border-cyan-100 hover:bg-cyan-100',
  ghost: 'bg-transparent text-cyan-700 border border-transparent hover:bg-cyan-50',
  danger: 'bg-verdict-fail text-white border border-transparent hover:bg-red-800 active:bg-red-900',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-2.5 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, variant = 'primary', size = 'md', isLoading, className, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'focus-ring inline-flex items-center justify-center rounded-lg font-medium transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && (
        <svg className="h-4 w-4 animate-spin text-current" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
});

export default Button;
