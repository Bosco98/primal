/**
 * The controls walkthrough — opened deliberately, never forced.
 *
 * A player who already knows how to play should not have to dismiss a tutorial
 * to start, and a player who doesn't should not have to guess. So this is a
 * button on the home screen, not a gate in front of it.
 */
export function ControlsGuide({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="guide__panel">
        <header className="guide__head">
          <h2>How to play</h2>
          <button type="button" className="guide__close" onClick={onClose} autoFocus>
            Close
          </button>
        </header>

        <p className="guide__lede">
          Your body is the controller. Stand back until you can see all of yourself in the
          camera, then move to the marks. There is nothing to calibrate — the lines follow
          you.
        </p>

        <div className="guide__diagram" aria-hidden>
          <div className="guide__grid">
            <div className="guide__line guide__line--jump">
              <span>JUMP</span>
            </div>
            <div className="guide__row">
              <div className="guide__cell">
                <span className="guide__dot" />
                LEFT
              </div>
              <div className="guide__cell guide__cell--on">
                <span className="guide__dot guide__dot--on" />
                CENTRE
              </div>
              <div className="guide__cell">
                <span className="guide__dot" />
                RIGHT
              </div>
            </div>
            <div className="guide__line guide__line--duck">
              <span>DUCK</span>
            </div>
          </div>
        </div>

        <ul className="guide__moves">
          <li>
            <b className="guide__key guide__key--side">Hop left / right</b>
            <span>
              Jump sideways into the left or right band to change lane. Your position on
              screen <em>is</em> your lane — hop back to the middle to come back.
            </span>
          </li>
          <li>
            <b className="guide__key guide__key--jump">Jump</b>
            <span>
              Get both feet above the orange line. It sits just above where your feet
              normally are, so a real hop clears it and a shuffle does not.
            </span>
          </li>
          <li>
            <b className="guide__key guide__key--duck">Duck</b>
            <span>
              Squat until your hips drop below the blue line. Knees soft, chest up — this
              one is doing most of the work on your legs.
            </span>
          </li>
          <li>
            <b className="guide__key guide__key--reach">Reach</b>
            <span>
              Your hands are two cursors. Stretch out to catch things off to the side, high
              overhead, or down by your knees. Full extension, not a lazy wave.
            </span>
          </li>
        </ul>

        <p className="guide__note">
          Move hard and you gain ground. Coast, and whatever is behind you closes in —
          that is the whole game.
        </p>

        <button type="button" className="guide__done" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
