'use client';
import { ReceiptText } from 'lucide-react';
import {
  FILM_WASTE_FACTOR,
  FULL_WRAP_PRICE_HIGH_YUAN,
  FULL_WRAP_PRICE_LOW_YUAN,
  LABOR_COST_SHARE,
  MATERIAL_COST_SHARE,
  type PriceEstimate,
} from '@/lib/plan-insights';
import { t, type Lang } from '@/lib/i18n';

/** 金额展示取整到十元，避免给出虚假的精确感。 */
const formatYuan = (value: number, lang: Lang) =>
  `¥${(Math.round(value / 10) * 10).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}`;

interface Props {
  lang: Lang;
  price: PriceEstimate;
}

export default function PriceEstimateCard({ lang, price }: Props) {
  const comparePercent = Math.round(price.ratioToFullWrap * 100);
  return (
    <article
      className="insight-card price-estimate-card"
      aria-label={t(lang, 'price.title')}
    >
      <div className="insight-card-head">
        <h3>
          <ReceiptText size={14} />
          {t(lang, 'price.title')}
        </h3>
        <span className="insight-estimate-tag">
          {t(lang, 'price.referenceTag')}
        </span>
      </div>
      <dl className="price-rows">
        <div className="price-total-row">
          <dt>{t(lang, 'price.total')}</dt>
          <dd>
            {formatYuan(price.priceLowYuan, lang)}–
            {formatYuan(price.priceHighYuan, lang)}
            <small>
              {t(lang, 'price.compare', { percent: comparePercent })}
            </small>
          </dd>
        </div>
        <div>
          <dt>{t(lang, 'price.film')}</dt>
          <dd>
            {price.filmAreaM2.toFixed(2)} ㎡
            <small>
              {t(lang, 'price.filmNote')} ×{FILM_WASTE_FACTOR}
            </small>
          </dd>
        </div>
        <div>
          <dt>
            {t(lang, 'price.material')}
            <small>{Math.round(MATERIAL_COST_SHARE * 100)}%</small>
          </dt>
          <dd>
            {formatYuan(price.materialLowYuan, lang)}–
            {formatYuan(price.materialHighYuan, lang)}
          </dd>
        </div>
        <div>
          <dt>
            {t(lang, 'price.labor')}
            <small>{Math.round(LABOR_COST_SHARE * 100)}%</small>
          </dt>
          <dd>
            {formatYuan(price.laborLowYuan, lang)}–
            {formatYuan(price.laborHighYuan, lang)}
          </dd>
        </div>
      </dl>
      <p className="insight-footnote">
        {t(lang, 'price.footnote', {
          low: FULL_WRAP_PRICE_LOW_YUAN.toLocaleString(
            lang === 'zh' ? 'zh-CN' : 'en-US',
          ),
          high: FULL_WRAP_PRICE_HIGH_YUAN.toLocaleString(
            lang === 'zh' ? 'zh-CN' : 'en-US',
          ),
        })}
      </p>
    </article>
  );
}
