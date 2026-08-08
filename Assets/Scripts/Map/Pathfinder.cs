using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class Pathfinder
    {
        public class PathNode
        {
            public Vector2Int Position;
            public int GCost;
            public int HCost;
            public int FCost => GCost + HCost;
            public PathNode Parent;

            public PathNode(Vector2Int pos)
            {
                Position = pos;
            }
        }

        // 簡易的なA*アルゴリズムの実装（フェーズ3初期段階: 徒歩と落下、1段差のジャンプに対応）
        public static List<Vector2Int> FindPath(CharacterBase character, Vector2Int startPos, Vector2Int targetPos)
        {
            List<PathNode> openList = new List<PathNode>();
            HashSet<Vector2Int> closedList = new HashSet<Vector2Int>();

            PathNode startNode = new PathNode(startPos);
            startNode.GCost = 0;
            startNode.HCost = GetDistance(startPos, targetPos);
            openList.Add(startNode);

            int maxIterations = 2000;
            int currentIteration = 0;

            while (openList.Count > 0 && currentIteration < maxIterations)
            {
                currentIteration++;
                PathNode currentNode = openList[0];
                for (int i = 1; i < openList.Count; i++)
                {
                    if (openList[i].FCost < currentNode.FCost || openList[i].FCost == currentNode.FCost && openList[i].HCost < currentNode.HCost)
                    {
                        currentNode = openList[i];
                    }
                }

                openList.Remove(currentNode);
                closedList.Add(currentNode.Position);

                if (currentNode.Position == targetPos)
                {
                    return RetracePath(startNode, currentNode);
                }

                foreach (PathNode neighbor in GetNeighbors(character, currentNode))
                {
                    if (closedList.Contains(neighbor.Position)) continue;

                    int newCostToNeighbor = currentNode.GCost + GetDistance(currentNode.Position, neighbor.Position);
                    if (newCostToNeighbor < neighbor.GCost || !openList.Contains(neighbor))
                    {
                        neighbor.GCost = newCostToNeighbor;
                        neighbor.HCost = GetDistance(neighbor.Position, targetPos);
                        neighbor.Parent = currentNode;

                        if (!openList.Contains(neighbor))
                        {
                            openList.Add(neighbor);
                        }
                    }
                }
            }

            return null; // 経路が見つからない場合
        }

        private static List<PathNode> GetNeighbors(CharacterBase character, PathNode node)
        {
            List<PathNode> neighbors = new List<PathNode>();
            
            // 3. ハシゴの昇降
            bool onLadder = GridManager.Instance.GetNode(node.Position).GetEntity<Ladder>() != null;
            if (onLadder)
            {
                // 上へ
                Vector2Int upPos = node.Position + Vector2Int.up;
                if (!GridManager.Instance.GetNode(upPos).IsSolid(character) && 
                    !GridManager.Instance.GetNode(upPos + Vector2Int.up).IsSolid(character))
                {
                    neighbors.Add(new PathNode(upPos));
                }
            }
            
            // 足元にハシゴがある場合（降りる）
            if (GridManager.Instance.GetNode(node.Position + Vector2Int.down).GetEntity<Ladder>() != null)
            {
                neighbors.Add(new PathNode(node.Position + Vector2Int.down));
            }

            int[] directions = { -1, 1 }; // 左右

            foreach (int dir in directions)
            {
                Vector2Int nextPos = node.Position + new Vector2Int(dir, 0);

                // 階段の処理（斜め移動）
                Stairs currentStairs = GridManager.Instance.GetNode(node.Position).GetEntity<Stairs>();
                if (currentStairs != null)
                {
                    if (currentStairs.Direction == StairDirection.RightUp)
                        nextPos += (dir == 1) ? Vector2Int.up : Vector2Int.down;
                    else if (currentStairs.Direction == StairDirection.LeftUp)
                        nextPos += (dir == -1) ? Vector2Int.up : Vector2Int.down;
                }
                else
                {
                    // 移動先が階段の場合（階段の登り始め）
                    Stairs nextStairs = GridManager.Instance.GetNode(nextPos).GetEntity<Stairs>();
                    if (nextStairs != null)
                    {
                        if (nextStairs.Direction == StairDirection.RightUp && dir == 1) nextPos += Vector2Int.up;
                        else if (nextStairs.Direction == StairDirection.LeftUp && dir == -1) nextPos += Vector2Int.up;
                    }
                }

                // 1. 通常の歩行または階段（横・斜め移動）
                GridNode footNode = GridManager.Instance.GetNode(nextPos);
                GridNode headNode = GridManager.Instance.GetNode(nextPos + Vector2Int.up);

                // 障害物がない場合
                if (!footNode.IsSolid(character) && !headNode.IsSolid(character))
                {
                    // 落下するかチェック
                    Vector2Int checkFallPos = nextPos;
                    int fallDepth = 0;
                    while (!GridManager.Instance.GetNode(checkFallPos + Vector2Int.down).IsSolid(character))
                    {
                        checkFallPos += Vector2Int.down;
                        fallDepth++;
                        // 落下制限（無限ループ防止）
                        if (fallDepth > 50) break;
                    }
                    if (fallDepth <= 50 && Mathf.Abs(checkFallPos.x - character.GridPosition.x) < 100) 
                    {
                        neighbors.Add(new PathNode(checkFallPos));
                    }
                }
                // 2. 段差ジャンプ（上へ1マス）
                else if (footNode.IsSolid(character))
                {
                    Vector2Int stepPos = nextPos + Vector2Int.up;
                    Vector2Int aboveHead = stepPos + Vector2Int.up;
                    Vector2Int currentAbove = node.Position + Vector2Int.up * 2;

                    if (!GridManager.Instance.GetNode(stepPos).IsSolid(character) &&
                        !GridManager.Instance.GetNode(aboveHead).IsSolid(character) &&
                        !GridManager.Instance.GetNode(currentAbove).IsSolid(character))
                    {
                        neighbors.Add(new PathNode(stepPos));
                    }
                }
                
                // ※ ここに幅跳びや、よじ登りのノード追加ロジックを拡充していく
            }

            return neighbors;
        }

        private static List<Vector2Int> RetracePath(PathNode startNode, PathNode endNode)
        {
            List<Vector2Int> path = new List<Vector2Int>();
            PathNode currentNode = endNode;

            while (currentNode != startNode)
            {
                path.Add(currentNode.Position);
                currentNode = currentNode.Parent;
            }
            
            path.Reverse();
            return path;
        }

        private static int GetDistance(Vector2Int nodeA, Vector2Int nodeB)
        {
            int dstX = Mathf.Abs(nodeA.x - nodeB.x);
            int dstY = Mathf.Abs(nodeA.y - nodeB.y);
            return dstX + dstY; // マンハッタン距離
        }
    }
}
