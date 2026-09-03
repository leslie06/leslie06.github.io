import type * as THREE from 'three';
import { PERF_BUDGET_LOW, type QualityTier } from './QualityTiers';

/**
 * 拿 renderer.info 跟 low 档预算对一下。
 *
 * 预算写在 CLAUDE.md 里，但文档拦不住任何人 —— 这个函数让"drawcall 超了"
 * 在开发时就以一行红字的形式出现，而不是等真机上掉帧才发现。
 * 只在 low 档查：high/medium 本来就不受这个约束。
 *
 * @returns 超标信息，没超就是空数组
 */
export function reportPerfBudget(renderer: THREE.WebGLRenderer, tier: QualityTier): string[] {
  if (tier !== 'low') return [];
  const { calls, triangles } = renderer.info.render;
  const problems: string[] = [];
  if (calls > PERF_BUDGET_LOW.drawCalls) {
    problems.push(`drawcall ${calls} 超了预算 ${PERF_BUDGET_LOW.drawCalls}（用 InstancedMesh 合并重复物件）`);
  }
  if (triangles > PERF_BUDGET_LOW.triangles) {
    problems.push(`三角面 ${triangles} 超了预算 ${PERF_BUDGET_LOW.triangles}`);
  }
  return problems;
}
