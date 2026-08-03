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
          Your body is the controller. Stand back until you can see yourself down to the
          knees, then move to the marks. There is nothing to calibrate — the game watches
          the dot on your hips, and both lines are drawn from where it rests.
        </p>

        <div className="guide__diagram" aria-hidden>
          <div className="guide__grid">
            <div className="guide__line guide__line--jump">
              <span>JUMP</span>
            </div>
            <div className="guide__line guide__line--stand">
              <span>standing</span>
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
              <span>SQUAT</span>
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
              Hop, and drive your hips above the orange line. It sits a hand's width above
              where you stand, so a real jump clears it and rocking onto your toes does
              not.
            </span>
          </li>
          <li>
            <b className="guide__key guide__key--duck">Squat</b>
            <span>
              Sit back until your hips drop past the blue line, which sits about two thirds
              of the way down to your knees — a half squat, not a bob. Chest up, knees
              tracking over your toes. This one does most of the work on your legs.
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
          Move with purpose and your gap grows. The game rewards full, confident movement —
          exactly what makes the workout count.
        </p>

        <button type="button" className="guide__done" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
