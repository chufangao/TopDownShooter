// The tests' solver, for a file that plays the expert's battles (solver.js): a budget of plans a battle and no slack
// read, and the formation's solves (bestFormation) their own budget a candidate, unless the environment names its own,
// so that a battle and a prep are quick and a function of their boards. A battle's budget reaches a turn or two of
// walking with a full field before a blow pays, as a sentry's room asks (sentries never come); a prep's needs less.
process.env.RETINUE_SOLVER_BUDGET ??= '1000'
process.env.RETINUE_SOLVER_SLACK ??= '0'
process.env.RETINUE_PREP_BUDGET ??= '300'
