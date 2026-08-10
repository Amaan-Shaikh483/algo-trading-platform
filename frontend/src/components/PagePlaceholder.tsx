interface Props {
  title: string
  specRef: string
  description: string
}

/**
 * Temporary scaffold page. Each placeholder names the spec section that will
 * replace it, so the module-by-module build order stays visible in the UI.
 */
export default function PagePlaceholder({ title, specRef, description }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{specRef}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-gray-900">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">{description}</p>
    </div>
  )
}
