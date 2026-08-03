import { useThree } from '@react-three/fiber'
import { forwardRef, type ReactNode, type Ref, useCallback, useEffect, useRef } from 'react'
import { type BufferGeometry, type Group, Mesh } from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  SAH,
  type SplitStrategy,
} from 'three-mesh-bvh'

type SceneBvhProps = {
  children?: ReactNode
  enabled?: boolean
  firstHitOnly?: boolean
  strategy?: SplitStrategy
  verbose?: boolean
  setBoundingBox?: boolean
  maxDepth?: number
  targetLeafSize?: number
  indirect?: boolean
}

const isMesh = (object: unknown): object is Mesh =>
  !!object && typeof object === 'object' && (object as Mesh).isMesh === true

const hasBvhCompatibleGeometry = (geometry?: BufferGeometry | null) => {
  if (!geometry) return false

  const position = geometry.getAttribute('position')
  if (!position) return false

  const vertexCount = geometry.getIndex()?.count ?? position.count
  if (vertexCount < 3) return false

  // A geometry whose groups are all count-0 yields zero BVH primitive ranges,
  // and three-mesh-bvh's computeBoundsTree throws on `firstRange.offset`. Such
  // geometry (e.g. a degenerate placeholder mesh) is not raycast-relevant.
  if (geometry.groups.length > 0 && !geometry.groups.some((group) => group.count > 0)) {
    return false
  }

  return true
}

export const SceneBvh = forwardRef<Group, SceneBvhProps>(
  (
    {
      children,
      enabled = true,
      firstHitOnly = false,
      strategy = SAH,
      verbose = false,
      setBoundingBox = true,
      maxDepth = 40,
      targetLeafSize = 10,
      indirect = false,
    },
    forwardedRef,
  ) => {
    const ref = useRef<Group>(null)
    const raycaster = useThree((state) => state.raycaster)

    // Store the group in the local ref and forward it to any parent ref.
    const setRef = useCallback(
      (group: Group | null) => {
        ref.current = group
        assignRef(forwardedRef, group)
      },
      [forwardedRef],
    )

    useEffect(() => {
      if (!enabled || !ref.current) return

      const options = {
        strategy,
        verbose,
        setBoundingBox,
        maxDepth,
        targetLeafSize,
        indirect,
      }
      const group = ref.current
      const acceleratedMeshes = new Set<Mesh>()
      const computedGeometries = new Set<BufferGeometry>()

      raycaster.firstHitOnly = firstHitOnly

      group.traverse((child) => {
        if (!isMesh(child)) return

        if (child.raycast === Mesh.prototype.raycast) {
          child.raycast = acceleratedRaycast
          acceleratedMeshes.add(child)
        }

        if (child.raycast !== acceleratedRaycast) return

        const geometry = child.geometry
        if (geometry.boundsTree || !hasBvhCompatibleGeometry(geometry)) return

        try {
          // Two `three-mesh-bvh` versions augment `three` here: `three-bvh-csg`
          // pulls 0.8.3 (`computeBoundsTree: (o?: MeshBVHOptions) => MeshBVH`)
          // while the viewer depends on 0.9.9 (`=> GeometryBVH`). The merged
          // `BufferGeometry.computeBoundsTree` signature resolves to 0.8.3's,
          // which the 0.9.9 helper is not assignable to. The runtime helpers
          // are correct; only the declared return types conflict, so an
          // `unknown` bridge is unavoidable until the versions are unified.
          geometry.computeBoundsTree =
            computeBoundsTree as unknown as typeof geometry.computeBoundsTree
          geometry.disposeBoundsTree = disposeBoundsTree
          geometry.computeBoundsTree(options)
          computedGeometries.add(geometry)
        } catch (error) {
          console.warn('[viewer] Skipping BVH for incompatible mesh geometry.', {
            mesh: child.name || child.type,
            reason: error instanceof Error ? error.message : String(error),
            groups: geometry.groups.length,
          })
        }
      })

      return () => {
        delete raycaster.firstHitOnly

        for (const geometry of computedGeometries) {
          if (geometry.boundsTree) {
            geometry.disposeBoundsTree()
          }
        }

        for (const mesh of acceleratedMeshes) {
          if (mesh.raycast === acceleratedRaycast) {
            mesh.raycast = Mesh.prototype.raycast
          }
        }
      }
    }, [
      enabled,
      firstHitOnly,
      strategy,
      verbose,
      setBoundingBox,
      maxDepth,
      targetLeafSize,
      indirect,
      raycaster,
    ])

    return <group ref={setRef}>{children}</group>
  },
)

function assignRef(ref: Ref<Group>, value: Group | null) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

SceneBvh.displayName = 'SceneBvh'
