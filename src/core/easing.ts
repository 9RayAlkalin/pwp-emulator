const ease_table = (() => {
    const tbl: Float32Array[] = [];
    for (let type = 0; type <= 14; type++) {
        const row = new Float32Array(101);
        if (type >= 1 && type <= 12) {
            const n = Math.floor((type - 1) / 3) + 2;
            const kind = (type - 1) % 3;
            for (let i = 0; i <= 100; i++) {
                const p = i / 100;
                if (kind === 0) row[i] = Math.pow(p, n);
                else if (kind === 1) row[i] = 1 - Math.pow(1 - p, n);
                else row[i] = p < 0.5 ? 0.5 * Math.pow(2 * p, n) : 1 - 0.5 * Math.pow(2 - 2 * p, n);
            }
        } else if (type === 14) {
            row.fill(1);
        } else if (type !== 13) {
            for (let i = 0; i <= 100; i++) row[i] = i / 100;   // 0 = Liner
        }
        tbl[type] = row;
    }
    return tbl;
})();

export const ease = (p, type) => {
    const row = ease_table[type] || ease_table[0];
    if (p <= 0) return row[0];
    if (p >= 1) return row[100];
    const x = p * 100;
    const i = Math.floor(x);
    return row[i] + (x - i) * (row[i + 1] - row[i]);
};

