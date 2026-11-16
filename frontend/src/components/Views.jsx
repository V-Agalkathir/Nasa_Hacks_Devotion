// The Simple · Advanced · Research switch, the same at the top of every view.
const VIEWS = [["simple", "Simple", "#simple"], ["advanced", "Advanced", "#advanced"], ["research", "Research", "#nisar"]];

export default function Views({ on }) {
  return (
    <nav className="gk-views" aria-label="Views">
      {VIEWS.map(([k, t, href]) => (k === on
        ? <span key={k} className="on" aria-current="page">{t}</span>
        : <a key={k} href={href}>{t}</a>))}
    </nav>
  );
}
