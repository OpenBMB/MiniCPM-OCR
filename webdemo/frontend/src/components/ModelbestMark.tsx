interface ModelbestMarkProps {
  size?: number;
  className?: string;
}

/**
 * ModelBest brand mark (the M graphic only, no wordmark).
 *
 * Purpose: square brand slots in the sidebar and top bar, and other places that need an icon alone (see BrandLogo for the horizontal wordmark).
 * The path is the blue graphic from the official logo; color inherits currentColor so it can reverse to white on a primary background.
 *
 * @param size Size in pixels (width and height match).
 * @param className Extra styles (for example text-primary-foreground to set the color).
 */
export function ModelbestMark({ size = 20, className }: ModelbestMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 174 145"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M107.871 95.0896L169.395 136.078L152.218 144.723L98.3607 101.362L107.871 95.0896ZM130.829 50.0383V63.8369L18.1331 144.502L24.9929 62.0745L34.7552 67.6561V113.738L130.829 50.0383ZM0 15.8596L55.9454 57.8105L46.4201 65.2244L15.6528 44.9672L10.5077 137.64L1.71495 128.996L0 15.8596ZM162.703 7.34171L171.496 15.9907L173.211 128.206L117.976 86.7089L126.791 79.763L157.559 100.021L162.703 7.34171ZM155.076 0.484674L148.216 82.9131L138.455 76.4747V31.2547L42.3815 94.9539V81.1523L155.076 0.484674ZM21.0007 0.268066L74.8514 43.6254L66.0509 49.4307L4.52833 8.44325L21.0007 0.268066Z"
        fill="currentColor"
      />
    </svg>
  );
}
