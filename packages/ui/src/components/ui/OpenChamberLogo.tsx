import React from 'react';
import { useI18n } from '@/lib/i18n';
import {
  PICHAMBER_CUBE_PATHS,
  PICHAMBER_INNER_GLYPH_PATHS,
  PICHAMBER_INNER_GLYPH_TRANSFORM,
  PICHAMBER_MARK_VIEWBOX,
} from './pichamber-mark';

interface OpenChamberLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
}

export const OpenChamberLogo: React.FC<OpenChamberLogoProps> = ({
  className = '',
  width = 70,
  height = 70,
  isAnimated = false,
}) => {
  const { t } = useI18n();

  return (
    <svg
      width={width}
      height={height}
      viewBox={PICHAMBER_MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t('openChamberLogo.aria.logo')}
    >
      {isAnimated ? (
        <style>{`@keyframes oc-logo-glow{0%,100%{opacity:0.55;transform:translateZ(0) scale(1)}50%{opacity:1;transform:translateZ(0) scale(1.04)}}.oc-logo-glow{animation:oc-logo-glow 1.8s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.oc-logo-glow{animation:none}}`}</style>
      ) : null}
      {PICHAMBER_CUBE_PATHS.map((path) => (
        <path
          key={path.d}
          d={path.d}
          fill={'fill' in path ? path.fill : 'currentColor'}
          fillOpacity={'fillOpacity' in path ? path.fillOpacity : undefined}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      <g
        className={isAnimated ? 'oc-logo-glow' : undefined}
        transform={PICHAMBER_INNER_GLYPH_TRANSFORM}
        fill="currentColor"
      >
        {PICHAMBER_INNER_GLYPH_PATHS.map((path) => (
          <path
            key={path.d}
            d={path.d}
            fillRule={'fillRule' in path ? path.fillRule : undefined}
          />
        ))}
      </g>
    </svg>
  );
};

export const PichamberLogo = OpenChamberLogo;
