'use client';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { COMPLIANCE_THRESHOLD_RATIO } from '@/lib/plan-insights';
import { t, type Lang } from '@/lib/i18n';

interface Props {
  lang: Lang;
  /** 覆盖率 0–1（估算）。 */
  ratio: number;
  decalAreaM2: number;
  totalSideAreaM2: number;
  overThreshold: boolean;
}

export default function CoverageMeter({
  lang,
  ratio,
  decalAreaM2,
  totalSideAreaM2,
  overThreshold,
}: Props) {
  const percent = ratio * 100;
  const barWidth = Math.min(100, Math.max(0, percent));
  const thresholdLeft = COMPLIANCE_THRESHOLD_RATIO * 100;
  return (
    <article
      className={`insight-card coverage-meter ${overThreshold ? 'is-over' : ''}`}
      aria-label={t(lang, 'coverage.title')}
    >
      <div className="insight-card-head">
        <h3>{t(lang, 'coverage.title')}</h3>
        <span className="insight-estimate-tag">
          {t(lang, 'coverage.estimateTag')}
        </span>
      </div>
      <div className="coverage-value">
        <strong>{percent.toFixed(1)}%</strong>
      </div>
      <div className="coverage-bar" aria-hidden="true">
        <span className="coverage-bar-fill" style={{ width: `${barWidth}%` }} />
        <i
          className="coverage-bar-threshold"
          style={{ left: `${thresholdLeft}%` }}
        />
      </div>
      <div className="coverage-bar-caption">
        <span>
          {t(lang, 'coverage.decalArea')} {decalAreaM2.toFixed(2)} ㎡
        </span>
        <span>
          {t(lang, 'coverage.sideArea')} {totalSideAreaM2.toFixed(1)} ㎡
        </span>
      </div>
      <p className={`coverage-badge ${overThreshold ? 'is-warn' : 'is-ok'}`}>
        {overThreshold ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
        <span>
          {overThreshold
            ? t(lang, 'coverage.warnBadge')
            : t(lang, 'coverage.okBadge')}
        </span>
        <span className="coverage-threshold-note">
          {t(lang, 'coverage.threshold')}
        </span>
      </p>
      <p className="insight-footnote">{t(lang, 'coverage.footnote')}</p>
    </article>
  );
}
