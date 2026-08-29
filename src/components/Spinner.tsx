/**
 * The one spinner.
 *
 * Every async action in the workspace talks to something slower than a render:
 * a DNS lookup, a Supabase round trip to Tokyo, a model call. Without a
 * spinner all of those look identical to a dead button, and the honest
 * response to a dead button is to click it again — which is how one publish
 * becomes three.
 *
 * `inline` is for inside a button, where it replaces the label and must not
 * change the button's height. `block` is for a panel that has nothing to show
 * yet.
 */
export function Spinner({
  label,
  block = false,
}: {
  /** Say what is happening. "Loading" alone tells nobody anything. */
  label?: string;
  block?: boolean;
}) {
  if (block) {
    return (
      <div className="spin-block">
        <span className="spin" aria-hidden />
        {label ? <span>{label}</span> : null}
      </div>
    );
  }
  return (
    <span className="spin-inline">
      <span className="spin" aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
