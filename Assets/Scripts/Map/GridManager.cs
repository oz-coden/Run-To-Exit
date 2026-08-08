using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class GridManager : MonoBehaviour
    {
        public static GridManager Instance { get; private set; }

        private Dictionary<Vector2Int, GridNode> gridData = new Dictionary<Vector2Int, GridNode>();

        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
            }
            else
            {
                Destroy(gameObject);
            }
        }

        public void ClearGrid()
        {
            gridData.Clear();
        }

        public GridNode GetNode(Vector2Int pos)
        {
            if (!gridData.TryGetValue(pos, out GridNode node))
            {
                node = new GridNode(pos);
                gridData[pos] = node;
            }
            return node;
        }

        public void AddWall(Vector2Int pos)
        {
            GetNode(pos).IsWall = true;
        }

        public void AddEntity(IGridEntity entity)
        {
            GetNode(entity.GridPosition).Entities.Add(entity);
        }

        public void RemoveEntity(IGridEntity entity)
        {
            GetNode(entity.GridPosition).Entities.Remove(entity);
        }

        public void MoveEntity(IGridEntity entity, Vector2Int oldPos, Vector2Int newPos)
        {
            GetNode(oldPos).Entities.Remove(entity);
            GetNode(newPos).Entities.Add(entity);
        }

        public bool IsWallAt(Vector2Int gridPos)
        {
            return GetNode(gridPos).IsWall;
        }

        // 旧コード互換性
        public Collider2D GetObjectAt(Vector2Int gridPos)
        {
            return Physics2D.OverlapPoint(new Vector2(gridPos.x, gridPos.y));
        }

        public T GetComponentAt<T>(Vector2Int gridPos) where T : Component
        {
            Collider2D col = GetObjectAt(gridPos);
            if (col != null)
            {
                return col.GetComponent<T>();
            }
            return null;
        }
    }
}
