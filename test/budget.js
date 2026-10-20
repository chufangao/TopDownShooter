// The tests' solver, for a file that plays the expert's battles (solver.js): a budget of plans a battle and no slack
// read, unless the environment names its own, so that a battle is quick and a function of its board.
process.env.RETINUE_SOLVER_BUDGET ??= '300'
process.env.RETINUE_SOLVER_SLACK ??= '0'
