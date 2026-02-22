const GRID_SIZE = 9;
const MAX_AGE = 7;
const WATER_SPEED_MS = 100;
const WATER_CLEAR_MS = 300;
let grid = [];
let enemyGrid = [];
let totalYield = 0;
let totalTicks = 0;
let enemyYield = 0;
let isPlaying = false;
let simulationInterval = null;
let currentSpeed = 50;
let isHarvesting = false;
let enemyIsHarvesting = false;
let isCompetitive = false;
const gridContainer = document.getElementById('farm-grid');
const enemyGridContainer = document.getElementById('enemy-farm-grid');
const statYield = document.getElementById('stat-yield');
const statTicks = document.getElementById('stat-ticks');
const statYieldTime = document.getElementById('stat-yield-time');
const stdStatsBlock = document.getElementById('standard-stats');
const playerInlineStats = document.getElementById('player-inline-stats');
const statYieldTimePlayer = document.getElementById('stat-yield-time-player');
const statYieldTimeEnemy = document.getElementById('stat-yield-time-enemy');
const statYieldPlayer = document.getElementById('stat-yield-player');
const statYieldEnemy = document.getElementById('stat-yield-enemy');
const strategySelect = document.getElementById('strategy-select');
const competeToggle = document.getElementById('compete-toggle');
const competeGroup = document.getElementById('compete-group');
const enemyStrategy = document.getElementById('enemy-strategy');
const playerFarmTitle = document.getElementById('player-farm-title');
const enemySection = document.getElementById('enemy-section');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnStep = document.getElementById('btn-step');
const btnHarvest = document.getElementById('btn-harvest');
const btnReset = document.getElementById('btn-reset');
const rightStrategyLabel = document.getElementById('right-strategy-label');
const leftStrategyLabel = document.getElementById('left-strategy-label');

const playerThresholdGroup = document.getElementById('player-threshold-group');
const playerThreshold = document.getElementById('player-threshold');
const playerThresholdLabel = document.getElementById('player-threshold-label');

const enemyThresholdGroup = document.getElementById('enemy-threshold-group');
const enemyThreshold = document.getElementById('enemy-threshold');
const enemyThresholdLabel = document.getElementById('enemy-threshold-label');
function init() {
    createGrid();
    resetSimulation();
    setupEventListeners();
    updateUI();
}
function createGrid() {
    gridContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`;
    gridContainer.innerHTML = '';
    enemyGridContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
    enemyGridContainer.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`;
    enemyGridContainer.innerHTML = '';
    for (let r = 0; r < GRID_SIZE; r++) {
        let row = [];
        let enemyRow = [];
        for (let c = 0; c < GRID_SIZE; c++) {
            const cell = document.createElement('div');
            cell.classList.add('crop-cell');
            cell.id = `cell-${r}-${c}`;
            gridContainer.appendChild(cell);
            row.push(0);
            const enemyCell = document.createElement('div');
            enemyCell.classList.add('crop-cell');
            enemyCell.id = `enemy-cell-${r}-${c}`;
            enemyGridContainer.appendChild(enemyCell);
            enemyRow.push(0);
        }
        grid.push(row);
        enemyGrid.push(enemyRow);
    }
}
function resetSimulation() {
    pauseSimulation();
    totalYield = 0;
    totalTicks = 0;
    enemyYield = 0;
    isHarvesting = false;
    enemyIsHarvesting = false;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            grid[r][c] = 0;
            updateCellVisual(r, c, false);
            enemyGrid[r][c] = 0;
            updateCellVisual(r, c, true);
        }
    }
    updateUI();
}
function updateCellVisual(r, c, isEnemy) {
    const age = isEnemy ? enemyGrid[r][c] : grid[r][c];
    const cellId = isEnemy ? `enemy-cell-${r}-${c}` : `cell-${r}-${c}`;
    const cell = document.getElementById(cellId);
    if (cell) {
        cell.style.backgroundImage = `url('assets/stage_${age}.png'), url('assets/dirt.png')`;
    }
}
function updateUI() {
    statYield.innerText = totalYield.toLocaleString();
    statTicks.innerText = totalTicks.toLocaleString();
    const yieldPerTime = totalTicks > 0 ? (totalYield / totalTicks) : 0;
    statYieldTime.innerText = yieldPerTime.toFixed(4);
    statYieldPlayer.innerText = totalYield.toLocaleString();
    statYieldEnemy.innerText = enemyYield.toLocaleString();
    statYieldTimePlayer.innerText = yieldPerTime.toFixed(4);
    const enemyYieldPerTime = totalTicks > 0 ? (enemyYield / totalTicks) : 0;
    statYieldTimeEnemy.innerText = enemyYieldPerTime.toFixed(4);
}
function stepSimulation() {
    if (!isHarvesting || !enemyIsHarvesting) {
        totalTicks++;
    }
    if (!isHarvesting) {
        const r = Math.floor(Math.random() * GRID_SIZE);
        const c = Math.floor(Math.random() * GRID_SIZE);
        if (grid[r][c] < MAX_AGE) {
            grid[r][c]++;
            updateCellVisual(r, c, false);
        }
        if (evaluateStrategy(grid, strategySelect.value, false)) {
            doHarvest(false);
        }
    }
    if (isCompetitive && !enemyIsHarvesting) {
        const r = Math.floor(Math.random() * GRID_SIZE);
        const c = Math.floor(Math.random() * GRID_SIZE);
        if (enemyGrid[r][c] < MAX_AGE) {
            enemyGrid[r][c]++;
            updateCellVisual(r, c, true);
        }
        if (evaluateStrategy(enemyGrid, enemyStrategy.value, true)) {
            doHarvest(true);
        }
    }
    updateUI();
}
function countFullyGrown(g) {
    let grown = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (g[r][c] === MAX_AGE) grown++;
        }
    }
    return grown;
}
function doHarvest(isEnemy = false) {
    let targetGrid = isEnemy ? enemyGrid : grid;
    const grownCount = countFullyGrown(targetGrid);
    if (isEnemy) {
        enemyYield += grownCount;
        enemyIsHarvesting = true;
    } else {
        totalYield += grownCount;
        isHarvesting = true;
    }
    let row = 0;
    function animateWaterRow() {
        const isStillHarvesting = isEnemy ? enemyIsHarvesting : isHarvesting;
        if (!isStillHarvesting) return;
        if (row < GRID_SIZE) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const cellId = isEnemy ? `enemy-cell-${row}-${c}` : `cell-${row}-${c}`;
                const cell = document.getElementById(cellId);
                if (cell) {
                    cell.style.backgroundImage = `url('assets/water.png'), url('assets/dirt.png')`;
                }
            }
            row++;
            setTimeout(animateWaterRow, WATER_SPEED_MS);
        } else {
            setTimeout(() => {
                const isStillHarvestingAfterWait = isEnemy ? enemyIsHarvesting : isHarvesting;
                if (!isStillHarvestingAfterWait) return;
                for (let r = 0; r < GRID_SIZE; r++) {
                    for (let c = 0; c < GRID_SIZE; c++) {
                        targetGrid[r][c] = 0;
                        updateCellVisual(r, c, isEnemy);
                    }
                }
                if (isEnemy) enemyIsHarvesting = false;
                else isHarvesting = false;
            }, WATER_CLEAR_MS);
        }
    }
    animateWaterRow();
}
function evaluateStrategy(g, strategy, isEnemy = false) {
    const totalCrops = GRID_SIZE * GRID_SIZE;
    const grownCount = countFullyGrown(g);
    if (strategy === 'manual') {
        return false;
    }
    else if (strategy === 'threshold') {
        const thresholdPct = isEnemy ? parseInt(enemyThreshold.value) : parseInt(playerThreshold.value);
        const requiredCrops = Math.ceil((totalCrops * thresholdPct) / 100);
        return grownCount >= requiredCrops;
    }
    else if (strategy === 'naive_heuristic') {
        const remaining = totalCrops - grownCount;
        if (remaining === 0) return true;
        const expectedTicksForNextGrowth = totalCrops / remaining;
        const averageTicksPerYieldFromScratch = MAX_AGE;

        if (expectedTicksForNextGrowth > averageTicksPerYieldFromScratch) {
            return true;
        }
        return false;
    }
    else if (strategy === 'true_expected_value') {
        const remaining = totalCrops - grownCount;
        if (remaining === 0) return true;

        let expectedTicksToFinish = 0;
        let flattenedGrownCount = 0;

        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                flattenedGrownCount += g[r][c];
            }
        }

        const maxPossibleStages = totalCrops * MAX_AGE;
        const remainingStages = maxPossibleStages - flattenedGrownCount;

        expectedTicksToFinish = remainingStages * (totalCrops / (remaining || 1));

        if ((expectedTicksToFinish / remaining) > MAX_AGE) {
            return true;
        }
        return false;
    }
    else if (strategy === 'diminishing_returns') {
        if (grownCount === totalCrops) return true;
        if (grownCount === 0) return false;

        const wastedHitProbability = grownCount / totalCrops;

        if (wastedHitProbability > 0.85) {
            return true;
        }
        return false;
    }
    return false;
}
function setSimulationSpeed() {
    const maxInterval = 500;
    const minInterval = 10;
    const interval = maxInterval - ((currentSpeed - 1) / 99) * (maxInterval - minInterval);
    if (isPlaying) {
        clearInterval(simulationInterval);
        simulationInterval = setInterval(stepSimulation, interval);
    }
}
function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
        btnPlayPause.innerText = 'Pause';
        btnPlayPause.classList.remove('primary-btn');
        btnPlayPause.style.backgroundColor = '#ff9800';
        setSimulationSpeed();
    } else {
        pauseSimulation();
    }
}
function pauseSimulation() {
    isPlaying = false;
    btnPlayPause.innerText = 'Play';
    btnPlayPause.classList.add('primary-btn');
    btnPlayPause.style.backgroundColor = '';
    clearInterval(simulationInterval);
}
function setupEventListeners() {
    btnPlayPause.addEventListener('click', togglePlayPause);
    btnStep.addEventListener('click', () => {
        pauseSimulation();
        stepSimulation();
    });
    btnHarvest.addEventListener('click', () => {
        if (!isHarvesting) {
            doHarvest();
        }
    });
    btnReset.addEventListener('click', resetSimulation);
    strategySelect.addEventListener('change', (e) => {
        if (e.target.value === 'manual') {
            btnHarvest.style.display = 'block';
        } else {
            btnHarvest.style.display = 'none';
        }

        if (e.target.value === 'threshold') {
            playerThresholdGroup.style.display = 'flex';
        } else {
            playerThresholdGroup.style.display = 'none';
        }
    });

    enemyStrategy.addEventListener('change', (e) => {
        if (e.target.value === 'threshold') {
            enemyThresholdGroup.style.display = 'flex';
        } else {
            enemyThresholdGroup.style.display = 'none';
        }
    });
    competeToggle.addEventListener('change', (e) => {
        isCompetitive = e.target.checked;
        if (isCompetitive) {
            enemySection.style.display = 'flex';
            playerFarmTitle.style.display = 'block';
            leftStrategyLabel.style.display = 'block';
            enemyStrategy.style.display = 'block';

            // Re-check inner strategy to restore slider if it was on threshold
            if (enemyStrategy.value === 'threshold') {
                enemyThresholdGroup.style.display = 'flex';
            }

            playerInlineStats.style.display = 'block';
            stdStatsBlock.style.display = 'none';
            rightStrategyLabel.innerText = 'Right Farm Strategy:';
        } else {
            enemySection.style.display = 'none';
            playerFarmTitle.style.display = 'none';
            leftStrategyLabel.style.display = 'none';
            enemyStrategy.style.display = 'none';
            enemyThresholdGroup.style.display = 'none'; // Fix: Force hide
            playerInlineStats.style.display = 'none';
            stdStatsBlock.style.display = 'block';
            rightStrategyLabel.innerText = 'Farm Strategy:';
        }
        resetSimulation();
    });

    playerThreshold.addEventListener('input', (e) => {
        playerThresholdLabel.innerText = e.target.value;
    });

    enemyThreshold.addEventListener('input', (e) => {
        enemyThresholdLabel.innerText = e.target.value;
    });

    if (strategySelect.value === 'manual') {
        btnHarvest.style.display = 'block';
    } else if (strategySelect.value === 'threshold') {
        playerThresholdGroup.style.display = 'flex';
    }

    if (enemyStrategy.value === 'threshold' && competeToggle.checked) {
        enemyThresholdGroup.style.display = 'flex';
    }
    speedSlider.addEventListener('input', (e) => {
        currentSpeed = parseInt(e.target.value);
        if (currentSpeed < 30) speedLabel.innerText = 'Slow';
        else if (currentSpeed < 70) speedLabel.innerText = 'Medium';
        else speedLabel.innerText = 'Fast';
        setSimulationSpeed();
    });
}
window.addEventListener('DOMContentLoaded', init);
