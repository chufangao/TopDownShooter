// The tests' solver, for a file that plays the expert's battles (solver.js): a budget of plans a battle and no slack
// read, and the formation's solves (bestFormation) the same budget a candidate, unless the environment names its own, so
// that a battle and a prep are quick and a function of their boards.
process.env.RETINUE_SOLVER_BUDGET ??= '300'
process.env.RETINUE_SOLVER_SLACK ??= '0'
process.env.RETINUE_PREP_BUDGET ??= '300'
