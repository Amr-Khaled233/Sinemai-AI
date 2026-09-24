'use client';

/**
 * Picking visual style tags.
 *
 * Shared by the producer's project form and the cinematographer's profile, which
 * is why it does not live inside either of them: a component reused across two
 * areas of the app in a file belonging to one of them drags that area's imports
 * — and its message namespace — into the other.
 *
 * It renders hidden inputs rather than posting JSON so it works inside a plain
 * form action, and it carries no strings of its own: tag labels come from the
 * database in both languages.
 */

export type StyleTag = { slug: string; labelEn: string; labelAr: string };

/** Eight tags is already more style direction than an agent can act on. */
const MAX_SELECTED = 8;

export function StyleTagPicker({
  tags,
  locale,
  selected,
  onChange,
  name = 'visualStyleTags',
}: {
  tags: StyleTag[];
  locale: string;
  selected: string[];
  onChange: (next: string[]) => void;
  name?: string;
}) {
  const toggle = (slug: string) => {
    onChange(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug].slice(0, MAX_SELECTED),
    );
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const on = selected.includes(tag.slug);
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => toggle(tag.slug)}
              className={`chip transition-colors ${on ? 'chip-on' : 'hover:border-accent/60'}`}
              aria-pressed={on}
            >
              {locale === 'ar' ? tag.labelAr : tag.labelEn}
            </button>
          );
        })}
      </div>
      {selected.map((slug) => (
        <input key={slug} type="hidden" name={name} value={slug} />
      ))}
    </>
  );
}
