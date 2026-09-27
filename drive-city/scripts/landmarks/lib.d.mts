import type { Document, NodeIO, Node } from '@gltf-transform/core';

export function roleOf(node: Node): 'detail' | 'near' | 'far' | 'solid' | 'walk' | 'mesh' | 'footprint' | 'clear';
export function createIO(): Promise<NodeIO>;
export function hull2(pts: [number, number][]): [number, number][];
export interface Inspection {
  footprint: [number, number][];
  /** Further FOOTPRINT objects, each hulled on its own (the largest is `footprint`). */
  moreFootprints: [number, number][][];
  clear: [number, number][][];
  height: number;
  stats: {
    triangles: number; farTriangles: number; materials: number; farMaterials: number;
    colliders: { solid: number; walk: number; mesh: number };
    instancedMeshes: number; textures: number; maxTexture: number; footprintArea: number;
  };
  warnings: string[];
  notes: string[];
}
export function inspect(doc: Document): Inspection;
export function optimize(doc: Document, opts?: { maxTexture?: number; sharp?: unknown }): Promise<Document>;
