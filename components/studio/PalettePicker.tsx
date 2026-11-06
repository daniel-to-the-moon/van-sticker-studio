'use client';

import { useId } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { VEHICLE_PALETTES, type VehiclePalette } from '@/lib/vehicle-palettes';
import styles from './PalettePicker.module.css';

export default function PalettePicker({
  lang,
  selected,
  onSelect,
}: {
  lang: Lang;
  selected: VehiclePalette | null;
  onSelect: (palette: VehiclePalette | null) => void;
}) {
  const descriptionId = useId();
  return (
    <fieldset className={styles.panel} aria-describedby={descriptionId}>
      <legend>{t(lang, 'palette.title')}</legend>
      <div className={styles.header}>
        <p id={descriptionId}>{t(lang, 'palette.description')}</p>
        <button
          type="button"
          className={styles.restore}
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
        >
          {t(lang, 'palette.restore')}
        </button>
      </div>
      <div className={styles.grid}>
        {VEHICLE_PALETTES.map((palette) => {
          const name = t(lang, palette.nameKey);
          const label = t(lang, 'palette.swatchAria', { name, ...palette });
          const active = selected?.id === palette.id;
          return (
            <button
              key={palette.id}
              type="button"
              className={styles.option}
              aria-label={label}
              title={label}
              aria-pressed={active}
              onClick={() => onSelect(palette)}
            >
              <span className={styles.swatch} aria-hidden="true">
                <span style={{ backgroundColor: palette.white }} />
                <span style={{ backgroundColor: palette.trim }} />
                <span style={{ backgroundColor: palette.accent }} />
              </span>
              <span className={styles.name}>{name}</span>
              <span className={styles.check} aria-hidden="true">
                {active ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
