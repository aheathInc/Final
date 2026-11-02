import type { SVGProps } from 'react';
/** Shared A-Health heart/pulse mark. Uses the same corporate colour as its wordmark. */
export function BrandMark(props:SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>
    <path d="M3 11h4l2-4 4 8 2-4h6"/>
  </svg>;
}
