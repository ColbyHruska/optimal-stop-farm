(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════

    const GRID_SIZE = 9;
    const MAX_AGE = 7;
    const WATER_SPEED_MS = 100;
    const WATER_CLEAR_MS = 300;

    const state = {
        grid: [],
        enemyGrid: [],
        totalYield: 0,
        totalTicks: 0,
        enemyYield: 0,
        isPlaying: false,
        simulationInterval: null,
        currentSpeed: 50,
        isHarvesting: false,
        enemyIsHarvesting: false,
        isCompetitive: false,
        playerHistory: [],
        enemyHistory: [],
    };

    function resetState() {
        state.totalYield = 0;
        state.totalTicks = 0;
        state.enemyYield = 0;
        state.isHarvesting = false;
        state.enemyIsHarvesting = false;
        state.playerHistory = [];
        state.enemyHistory = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                state.grid[r][c] = 0;
                state.enemyGrid[r][c] = 0;
            }
        }
    }

    function initGridArrays() {
        state.grid = [];
        state.enemyGrid = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            const row = [];
            const enemyRow = [];
            for (let c = 0; c < GRID_SIZE; c++) {
                row.push(0);
                enemyRow.push(0);
            }
            state.grid.push(row);
            state.enemyGrid.push(enemyRow);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STRATEGIES
    // ═══════════════════════════════════════════════════════════════

    function countFullyGrown(grid) {
        let grown = 0;
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                if (grid[r][c] === MAX_AGE) grown++;
            }
        }
        return grown;
    }

    const STRATEGIES = {
        manual() {
            return false;
        },

        threshold(grid, config) {
            const totalCrops = GRID_SIZE * GRID_SIZE;
            const grownCount = countFullyGrown(grid);
            const requiredCrops = Math.ceil((totalCrops * config.thresholdPct) / 100);
            return grownCount >= requiredCrops;
        },

        naive_heuristic(grid) {
            const totalCrops = GRID_SIZE * GRID_SIZE;
            const grownCount = countFullyGrown(grid);
            const remaining = totalCrops - grownCount;
            if (remaining === 0) return true;
            const expectedTicksForNextGrowth = totalCrops / remaining;
            return expectedTicksForNextGrowth > MAX_AGE;
        },

        smart_heuristic(grid) {
            const totalCrops = GRID_SIZE * GRID_SIZE;
            const grownCount = countFullyGrown(grid);
            if (grownCount === 0) return false;
            if (grownCount === totalCrops) return true;

            const ageCounts = new Array(MAX_AGE + 1).fill(0);
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    ageCounts[grid[r][c]]++;
                }
            }

            let remainingHits = 0;
            for (let age = 0; age < MAX_AGE; age++) {
                remainingHits += ageCounts[age] * (MAX_AGE - age);
            }

            const remaining = totalCrops - grownCount;
            const avgCostPerHit = totalCrops / remaining;
            const expectedTicks = remainingHits * avgCostPerHit;
            const marginalCostPerCrop = expectedTicks / remaining;

            return marginalCostPerCrop > MAX_AGE;
        },

        fixed_time_lookahead(grid) {
            const totalCrops = GRID_SIZE * GRID_SIZE;
            const N = totalCrops;
            const M = MAX_AGE;

            if (!STRATEGIES.dpCache) {
                const MAX_K = 2000;
                // P[k][h] = prob of exactly h hits in k ticks
                const P = [];
                for (let k = 0; k <= MAX_K; k++) {
                    P.push(new Float64Array(M + 1));
                }
                P[0][0] = 1.0;
                for (let k = 1; k <= MAX_K; k++) {
                    P[k][0] = P[k - 1][0] * (1 - 1 / N);
                    for (let h = 1; h < M; h++) {
                        P[k][h] = P[k - 1][h] * (1 - 1 / N) + P[k - 1][h - 1] * (1 / N);
                    }
                    // For M, it's >= M hits
                    P[k][M] = P[k - 1][M] + P[k - 1][M - 1] * (1 / N);
                }

                let maxRate = 0;
                for (let k = 1; k <= MAX_K; k++) {
                    let expectedYield = N * P[k][M];
                    let rate = expectedYield / k;
                    if (rate > maxRate) {
                        maxRate = rate;
                    }
                }

                STRATEGIES.dpCache = P;
                STRATEGIES.lambdaStar = maxRate;
                STRATEGIES.MAX_K = MAX_K;
            }

            let currentYield = countFullyGrown(grid);
            if (currentYield === N) return true;
            if (currentYield === 0) return false;

            const ageCounts = new Array(M + 1).fill(0);
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    ageCounts[grid[r][c]]++;
                }
            }

            let maxExpectedSurplus = 0;
            for (let k = 1; k <= STRATEGIES.MAX_K; k++) {
                let expectedYield = 0;
                for (let age = 0; age <= M; age++) {
                    if (ageCounts[age] === 0) continue;
                    let rem = M - age;
                    if (rem === 0) {
                        expectedYield += ageCounts[age];
                        continue;
                    }

                    let probReachingM = 0;
                    for (let h = rem; h <= M; h++) {
                        probReachingM += STRATEGIES.dpCache[k][h];
                    }
                    expectedYield += ageCounts[age] * probReachingM;
                }

                let surplus = expectedYield - STRATEGIES.lambdaStar * k;
                if (surplus > maxExpectedSurplus) {
                    maxExpectedSurplus = surplus;
                }
            }

            return currentYield >= maxExpectedSurplus;
        },
    };

    function evaluateStrategy(grid, strategyName, config) {
        const fn = STRATEGIES[strategyName];
        if (!fn) return false;
        return fn(grid, config);
    }

    // ═══════════════════════════════════════════════════════════════
    // GRID
    // ═══════════════════════════════════════════════════════════════

    function createGrid(gridContainer, enemyGridContainer) {
        gridContainer.style.gridTemplateColumns = 'repeat(' + GRID_SIZE + ', 1fr)';
        gridContainer.style.gridTemplateRows = 'repeat(' + GRID_SIZE + ', 1fr)';
        gridContainer.innerHTML = '';
        enemyGridContainer.style.gridTemplateColumns = 'repeat(' + GRID_SIZE + ', 1fr)';
        enemyGridContainer.style.gridTemplateRows = 'repeat(' + GRID_SIZE + ', 1fr)';
        enemyGridContainer.innerHTML = '';

        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                var cell = document.createElement('div');
                cell.classList.add('crop-cell');
                cell.id = 'cell-' + r + '-' + c;
                gridContainer.appendChild(cell);

                var enemyCell = document.createElement('div');
                enemyCell.classList.add('crop-cell');
                enemyCell.id = 'enemy-cell-' + r + '-' + c;
                enemyGridContainer.appendChild(enemyCell);
            }
        }
    }

    var STAGE_CLASSES = ['stage-0', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6', 'stage-7', 'water'];

    function setCellClass(cell, cls) {
        if (cell.dataset.stage === cls) return;
        var old = cell.dataset.stage;
        if (old) cell.classList.remove(old);
        cell.classList.add(cls);
        cell.dataset.stage = cls;
    }

    function updateCellVisual(r, c, isEnemy) {
        var age = isEnemy ? state.enemyGrid[r][c] : state.grid[r][c];
        var cellId = isEnemy ? ('enemy-cell-' + r + '-' + c) : ('cell-' + r + '-' + c);
        var cell = document.getElementById(cellId);
        if (cell) setCellClass(cell, 'stage-' + age);
    }

    function resetAllVisuals() {
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                updateCellVisual(r, c, false);
                updateCellVisual(r, c, true);
            }
        }
    }

    function stepGrowth(isEnemy) {
        var targetGrid = isEnemy ? state.enemyGrid : state.grid;
        var r = Math.floor(Math.random() * GRID_SIZE);
        var c = Math.floor(Math.random() * GRID_SIZE);
        if (targetGrid[r][c] < MAX_AGE) {
            targetGrid[r][c]++;
            var visualFrozen = isEnemy ? state.enemyIsHarvesting : state.isHarvesting;
            if (!visualFrozen) {
                updateCellVisual(r, c, isEnemy);
            }
            return true;
        }
        return false;
    }

    function doHarvest(isEnemy) {
        var targetGrid = isEnemy ? state.enemyGrid : state.grid;
        if (isEnemy && state.enemyIsHarvesting) return;
        if (!isEnemy && state.isHarvesting) return;

        var grownCount = countFullyGrown(targetGrid);

        if (isEnemy) {
            state.enemyYield += grownCount;
            state.enemyIsHarvesting = true;
        } else {
            state.totalYield += grownCount;
            state.isHarvesting = true;
        }

        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                targetGrid[r][c] = 0;
            }
        }

        // Purely cosmetic water animation
        var row = 0;
        function animateWaterRow() {
            var isStillHarvesting = isEnemy ? state.enemyIsHarvesting : state.isHarvesting;
            if (!isStillHarvesting) return;

            if (row < GRID_SIZE) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    var cellId = isEnemy ? ('enemy-cell-' + row + '-' + c) : ('cell-' + row + '-' + c);
                    var cell = document.getElementById(cellId);
                    if (cell) setCellClass(cell, 'water');
                }
                row++;
                setTimeout(animateWaterRow, WATER_SPEED_MS);
            } else {
                setTimeout(function () {
                    var stillHarvesting = isEnemy ? state.enemyIsHarvesting : state.isHarvesting;
                    if (!stillHarvesting) return;
                    // Re-sync visuals to actual grid state (may have grown during animation)
                    for (let r = 0; r < GRID_SIZE; r++) {
                        for (let c = 0; c < GRID_SIZE; c++) {
                            updateCellVisual(r, c, isEnemy);
                        }
                    }
                    if (isEnemy) state.enemyIsHarvesting = false;
                    else state.isHarvesting = false;
                }, WATER_CLEAR_MS);
            }
        }
        animateWaterRow();
    }

    // ═══════════════════════════════════════════════════════════════
    // CHART
    // ═══════════════════════════════════════════════════════════════

    var CHART_PADDING = { top: 30, right: 20, bottom: 40, left: 55 };
    var PLAYER_COLOR = '#4CAF50';
    var ENEMY_COLOR = '#ff9800';
    var GRID_COLOR = 'rgba(255, 255, 255, 0.07)';
    var AXIS_COLOR = 'rgba(255, 255, 255, 0.3)';
    var LABEL_COLOR = 'rgba(255, 255, 255, 0.6)';
    var TITLE_COLOR = 'rgba(255, 255, 255, 0.8)';
    var MAX_RENDER_POINTS = 600;

    var chartCanvas = null;
    var chartCtx = null;
    var renderScheduled = false;
    var chartDisplayWidth = 0;
    var chartDisplayHeight = 0;

    function initChart(canvasEl) {
        chartCanvas = canvasEl;
        chartCtx = chartCanvas.getContext('2d');
        resizeCanvas();
    }

    function resizeCanvas() {
        if (!chartCanvas) return;
        var rect = chartCanvas.getBoundingClientRect();
        chartDisplayWidth = rect.width;
        chartDisplayHeight = rect.height;
        var dpr = window.devicePixelRatio || 1;
        chartCanvas.width = rect.width * dpr;
        chartCanvas.height = rect.height * dpr;
        chartCtx.scale(dpr, dpr);
    }

    function scheduleRender(playerData, enemyData, showEnemy) {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(function () {
            renderScheduled = false;
            renderChart(playerData, enemyData, showEnemy);
        });
    }

    function downsample(data, maxPoints) {
        if (data.length <= maxPoints) return data;
        var step = data.length / maxPoints;
        var result = [data[0]];
        for (var i = 1; i < maxPoints - 1; i++) {
            result.push(data[Math.round(i * step)]);
        }
        result.push(data[data.length - 1]);
        return result;
    }

    function renderChart(playerData, enemyData, showEnemy) {
        if (!chartCtx || !chartCanvas) return;
        var displayWidth = chartDisplayWidth;
        var displayHeight = chartDisplayHeight;
        chartCtx.clearRect(0, 0, displayWidth, displayHeight);

        var chartWidth = displayWidth - CHART_PADDING.left - CHART_PADDING.right;
        var chartHeight = displayHeight - CHART_PADDING.top - CHART_PADDING.bottom;
        if (chartWidth <= 0 || chartHeight <= 0) return;

        var allData = showEnemy ? playerData.concat(enemyData) : playerData.slice();
        if (allData.length === 0) {
            chartCtx.fillStyle = LABEL_COLOR;
            chartCtx.font = '16px "VT323", monospace';
            chartCtx.textAlign = 'center';
            chartCtx.fillText('No data yet \u2014 start the simulation!', displayWidth / 2, displayHeight / 2);
            return;
        }

        var maxTick = 1, maxTotal = 1;
        for (var i = 0; i < allData.length; i++) {
            if (allData[i].tick > maxTick) maxTick = allData[i].tick;
            if (allData[i].total > maxTotal) maxTotal = allData[i].total;
        }
        var yMax = maxTotal * 1.1;

        drawGridLines(chartWidth, chartHeight, maxTick, yMax);
        drawAxes(chartWidth, chartHeight, maxTick, yMax);

        if (playerData.length > 0) drawLine(downsample(playerData, MAX_RENDER_POINTS), chartWidth, chartHeight, maxTick, yMax, PLAYER_COLOR);
        if (showEnemy && enemyData.length > 0) drawLine(downsample(enemyData, MAX_RENDER_POINTS), chartWidth, chartHeight, maxTick, yMax, ENEMY_COLOR);

        if (showEnemy) drawLegend(displayWidth);

        chartCtx.fillStyle = TITLE_COLOR;
        chartCtx.font = '14px "VT323", monospace';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Total Crops (Harvested + Grown) Over Time', displayWidth / 2, 16);
    }

    function drawGridLines(cw, ch, maxTick, yMax) {
        chartCtx.strokeStyle = GRID_COLOR;
        chartCtx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
            var y = CHART_PADDING.top + (ch * i) / 5;
            chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, y); chartCtx.lineTo(CHART_PADDING.left + cw, y); chartCtx.stroke();
        }
        var xSteps = Math.min(Math.ceil(maxTick / 100), 10) || 1;
        for (var j = 0; j <= xSteps; j++) {
            var x = CHART_PADDING.left + (cw * j) / xSteps;
            chartCtx.beginPath(); chartCtx.moveTo(x, CHART_PADDING.top); chartCtx.lineTo(x, CHART_PADDING.top + ch); chartCtx.stroke();
        }
    }

    function drawAxes(cw, ch, maxTick, yMax) {
        chartCtx.strokeStyle = AXIS_COLOR;
        chartCtx.lineWidth = 1.5;
        chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, CHART_PADDING.top); chartCtx.lineTo(CHART_PADDING.left, CHART_PADDING.top + ch); chartCtx.stroke();
        chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, CHART_PADDING.top + ch); chartCtx.lineTo(CHART_PADDING.left + cw, CHART_PADDING.top + ch); chartCtx.stroke();

        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.font = '12px "VT323", monospace';
        chartCtx.textAlign = 'right';
        for (var i = 0; i <= 5; i++) {
            var value = yMax * (1 - i / 5);
            var y = CHART_PADDING.top + (ch * i) / 5;
            chartCtx.fillText(Math.round(value).toString(), CHART_PADDING.left - 6, y + 4);
        }

        chartCtx.textAlign = 'center';
        var xSteps = Math.min(Math.ceil(maxTick / 100), 10) || 1;
        for (var j = 0; j <= xSteps; j++) {
            var val = Math.round((maxTick * j) / xSteps);
            var x = CHART_PADDING.left + (cw * j) / xSteps;
            chartCtx.fillText(val.toString(), x, CHART_PADDING.top + ch + 18);
        }

        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.font = '13px "VT323", monospace';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Ticks', CHART_PADDING.left + cw / 2, CHART_PADDING.top + ch + 34);
        chartCtx.save();
        chartCtx.translate(14, CHART_PADDING.top + ch / 2);
        chartCtx.rotate(-Math.PI / 2);
        chartCtx.fillText('Total Crops', 0, 0);
        chartCtx.restore();
    }

    function drawLine(data, cw, ch, maxTick, yMax, color) {
        if (data.length === 0) return;
        chartCtx.strokeStyle = color;
        chartCtx.lineWidth = 1.5;
        chartCtx.lineJoin = 'round';
        chartCtx.lineCap = 'round';
        chartCtx.beginPath();
        for (var i = 0; i < data.length; i++) {
            var x = CHART_PADDING.left + (data[i].tick / maxTick) * cw;
            var y = CHART_PADDING.top + ch - (data[i].total / yMax) * ch;
            if (i === 0) chartCtx.moveTo(x, y);
            else chartCtx.lineTo(x, y);
        }
        chartCtx.stroke();
    }

    function drawLegend(displayWidth) {
        var legendY = CHART_PADDING.top + 4;
        chartCtx.font = '13px "VT323", monospace';
        chartCtx.fillStyle = PLAYER_COLOR;
        chartCtx.fillRect(displayWidth - 170, legendY - 6, 10, 10);
        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.textAlign = 'left';
        chartCtx.fillText('Right Farm', displayWidth - 156, legendY + 3);
        chartCtx.fillStyle = ENEMY_COLOR;
        chartCtx.fillRect(displayWidth - 86, legendY - 6, 10, 10);
        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.fillText('Left Farm', displayWidth - 72, legendY + 3);
    }

    function clearChart(showEnemy) {
        renderChart([], [], showEnemy);
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN
    // ═══════════════════════════════════════════════════════════════

    var dom = {};

    function init() {
        dom = {
            gridContainer: document.getElementById('farm-grid'),
            enemyGridContainer: document.getElementById('enemy-farm-grid'),
            statYield: document.getElementById('stat-yield'),
            statTicks: document.getElementById('stat-ticks'),
            statYieldTime: document.getElementById('stat-yield-time'),
            stdStatsBlock: document.getElementById('standard-stats'),
            playerInlineStats: document.getElementById('player-inline-stats'),
            statYieldTimePlayer: document.getElementById('stat-yield-time-player'),
            statYieldTimeEnemy: document.getElementById('stat-yield-time-enemy'),
            statYieldPlayer: document.getElementById('stat-yield-player'),
            statYieldEnemy: document.getElementById('stat-yield-enemy'),
            strategySelect: document.getElementById('strategy-select'),
            competeToggle: document.getElementById('compete-toggle'),
            enemyStrategy: document.getElementById('enemy-strategy'),
            playerFarmTitle: document.getElementById('player-farm-title'),
            enemySection: document.getElementById('enemy-section'),
            speedSlider: document.getElementById('speed-slider'),
            speedLabel: document.getElementById('speed-label'),
            btnPlayPause: document.getElementById('btn-play-pause'),
            btnStep: document.getElementById('btn-step'),
            btnHarvest: document.getElementById('btn-harvest'),
            btnReset: document.getElementById('btn-reset'),
            rightStrategyLabel: document.getElementById('right-strategy-label'),
            leftStrategyLabel: document.getElementById('left-strategy-label'),
            playerThresholdGroup: document.getElementById('player-threshold-group'),
            playerThreshold: document.getElementById('player-threshold'),
            playerThresholdLabel: document.getElementById('player-threshold-label'),
            enemyThresholdGroup: document.getElementById('enemy-threshold-group'),
            enemyThreshold: document.getElementById('enemy-threshold'),
            enemyThresholdLabel: document.getElementById('enemy-threshold-label'),
            chartCanvas: document.getElementById('chart-canvas'),
            chartSection: document.getElementById('chart-section'),
        };

        initGridArrays();
        createGrid(dom.gridContainer, dom.enemyGridContainer);
        initChart(dom.chartCanvas);
        resetSimulation();
        setupEventListeners();
        updateUI();
    }

    function resetSimulation() {
        pauseSimulation();
        resetState();
        resetAllVisuals();
        updateUI();
        clearChart(state.isCompetitive);
    }

    function updateUI() {
        dom.statYield.textContent = state.totalYield.toLocaleString();
        dom.statTicks.textContent = state.totalTicks.toLocaleString();
        var yieldPerTime = state.totalTicks > 0 ? (state.totalYield / state.totalTicks) : 0;
        dom.statYieldTime.textContent = yieldPerTime.toFixed(4);
        dom.statYieldPlayer.textContent = state.totalYield.toLocaleString();
        dom.statYieldEnemy.textContent = state.enemyYield.toLocaleString();
        dom.statYieldTimePlayer.textContent = yieldPerTime.toFixed(4);
        var enemyYieldPerTime = state.totalTicks > 0 ? (state.enemyYield / state.totalTicks) : 0;
        dom.statYieldTimeEnemy.textContent = enemyYieldPerTime.toFixed(4);
    }

    function getStrategyConfig(isEnemy) {
        return {
            thresholdPct: parseInt(isEnemy ? dom.enemyThreshold.value : dom.playerThreshold.value),
        };
    }

    function recordSnapshot() {
        state.playerHistory.push({
            tick: state.totalTicks,
            total: state.totalYield + countFullyGrown(state.grid),
        });
        if (state.isCompetitive) {
            state.enemyHistory.push({
                tick: state.totalTicks,
                total: state.enemyYield + countFullyGrown(state.enemyGrid),
            });
        }
    }

    function stepSimulation() {
        state.totalTicks++;

        stepGrowth(false);
        if (!state.isHarvesting && evaluateStrategy(state.grid, dom.strategySelect.value, getStrategyConfig(false))) {
            doHarvest(false);
        }

        if (state.isCompetitive) {
            stepGrowth(true);
            if (!state.enemyIsHarvesting && evaluateStrategy(state.enemyGrid, dom.enemyStrategy.value, getStrategyConfig(true))) {
                doHarvest(true);
            }
        }

        recordSnapshot();
        scheduleRender(state.playerHistory, state.enemyHistory, state.isCompetitive);
        updateUI();
    }

    function setSimulationSpeed() {
        var maxInterval = 500;
        var minInterval = 10;
        var interval = maxInterval - ((state.currentSpeed - 1) / 99) * (maxInterval - minInterval);
        if (state.isPlaying) {
            clearInterval(state.simulationInterval);
            state.simulationInterval = setInterval(stepSimulation, interval);
        }
    }

    function togglePlayPause() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            dom.btnPlayPause.innerText = 'Pause';
            dom.btnPlayPause.classList.remove('primary-btn');
            dom.btnPlayPause.classList.add('pause-btn');
            setSimulationSpeed();
        } else {
            pauseSimulation();
        }
    }

    function pauseSimulation() {
        state.isPlaying = false;
        dom.btnPlayPause.innerText = 'Play';
        dom.btnPlayPause.classList.add('primary-btn');
        dom.btnPlayPause.classList.remove('pause-btn');
        clearInterval(state.simulationInterval);
    }

    function setupEventListeners() {
        dom.btnPlayPause.addEventListener('click', togglePlayPause);
        dom.btnStep.addEventListener('click', function () { pauseSimulation(); stepSimulation(); });
        dom.btnHarvest.addEventListener('click', function () { if (!state.isHarvesting) doHarvest(false); });
        dom.btnReset.addEventListener('click', resetSimulation);

        dom.strategySelect.addEventListener('change', function (e) {
            dom.btnHarvest.classList.toggle('hidden', e.target.value !== 'manual');
            dom.playerThresholdGroup.classList.toggle('hidden', e.target.value !== 'threshold');
        });

        dom.enemyStrategy.addEventListener('change', function (e) {
            dom.enemyThresholdGroup.classList.toggle('hidden', e.target.value !== 'threshold');
        });

        dom.competeToggle.addEventListener('change', function (e) {
            state.isCompetitive = e.target.checked;
            if (state.isCompetitive) {
                dom.enemySection.classList.remove('hidden');
                dom.playerFarmTitle.classList.remove('hidden');
                dom.leftStrategyLabel.classList.remove('hidden');
                dom.enemyStrategy.classList.remove('hidden');
                dom.playerInlineStats.classList.remove('hidden');
                dom.stdStatsBlock.classList.add('hidden');
                dom.rightStrategyLabel.innerText = 'Right Farm Strategy:';
                dom.chartSection.classList.add('chart-section--dual');
                if (dom.enemyStrategy.value === 'threshold') dom.enemyThresholdGroup.classList.remove('hidden');
            } else {
                dom.enemySection.classList.add('hidden');
                dom.playerFarmTitle.classList.add('hidden');
                dom.leftStrategyLabel.classList.add('hidden');
                dom.enemyStrategy.classList.add('hidden');
                dom.enemyThresholdGroup.classList.add('hidden');
                dom.playerInlineStats.classList.add('hidden');
                dom.stdStatsBlock.classList.remove('hidden');
                dom.rightStrategyLabel.innerText = 'Farm Strategy:';
                dom.chartSection.classList.remove('chart-section--dual');
            }
            // Sync canvas internal resolution to new CSS height before re-rendering
            setTimeout(function () { resizeCanvas(); clearChart(state.isCompetitive); }, 0);
            resetSimulation();
        });

        dom.playerThreshold.addEventListener('input', function (e) { dom.playerThresholdLabel.innerText = e.target.value; });
        dom.enemyThreshold.addEventListener('input', function (e) { dom.enemyThresholdLabel.innerText = e.target.value; });

        dom.speedSlider.addEventListener('input', function (e) {
            state.currentSpeed = parseInt(e.target.value);
            if (state.currentSpeed < 30) dom.speedLabel.innerText = 'Slow';
            else if (state.currentSpeed < 70) dom.speedLabel.innerText = 'Medium';
            else dom.speedLabel.innerText = 'Fast';
            setSimulationSpeed();
        });

        dom.btnHarvest.classList.toggle('hidden', dom.strategySelect.value !== 'manual');
        dom.playerThresholdGroup.classList.toggle('hidden', dom.strategySelect.value !== 'threshold');
        if (dom.enemyStrategy.value === 'threshold' && dom.competeToggle.checked) dom.enemyThresholdGroup.classList.remove('hidden');

        window.addEventListener('resize', function () {
            resizeCanvas();
            renderChart(state.playerHistory, state.enemyHistory, state.isCompetitive);
        });
    }

    window.addEventListener('DOMContentLoaded', init);
})();
