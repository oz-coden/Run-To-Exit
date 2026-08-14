using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public class MovableBox : MonoBehaviour, IGridEntity
    {
        public int RequiredPower = 1; // 1: 通常箱(青年も押せる), 2: 重い箱(大人のみ)
        public float MoveSpeed = 5f;
        private bool isMoving = false;

        public Vector2Int GridPosition => new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));

        public bool IsSolidTo(CharacterBase character) => true;
        public bool IsInteractable => false;
        public void OnInteract(CharacterBase character) {}

        private void Start()
        {
            if (GridManager.Instance != null)
            {
                GridManager.Instance.AddEntity(this);
            }
        }

        private void OnDestroy()
        {
            if (GridManager.Instance != null)
            {
                GridManager.Instance.RemoveEntity(this);
            }
        }

        public bool CanMoveTo(Vector2Int targetPos)
        {
            GridNode node = GridManager.Instance.GetNode(targetPos);
            if (node.IsWall) return false;
            foreach (var entity in node.Entities)
            {
                if (entity != this && entity.IsSolidTo(null)) return false;
            }
            Collider2D hit = GridManager.Instance.GetObjectAt(targetPos);
            if (hit != null && hit.gameObject != this.gameObject)
            {
                return false;
            }
            return true;
        }

        public void PushTo(Vector2Int targetPos)
        {
            if (!isMoving)
            {
                StartCoroutine(MoveRoutine(targetPos));
            }
        }

        private IEnumerator MoveRoutine(Vector2Int targetPos)
        {
            isMoving = true;
            Vector2Int oldPos = GridPosition;
            Vector3 endPos = new Vector3(targetPos.x, targetPos.y, 0);
            
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            if (GridManager.Instance != null)
            {
                GridManager.Instance.MoveEntity(this, oldPos, targetPos);
            }
            isMoving = false;

            CheckFall();
        }

        private void CheckFall()
        {
            Vector2Int below = GridPosition + Vector2Int.down;
            GridNode node = GridManager.Instance.GetNode(below);
            if (!node.IsSolid(null))
            {
                StartCoroutine(FallRoutine());
            }
        }

        private IEnumerator FallRoutine()
        {
            isMoving = true;
            while (true)
            {
                Vector2Int oldPos = GridPosition;
                Vector2Int below = GridPosition + Vector2Int.down;
                GridNode node = GridManager.Instance.GetNode(below);
                
                if (node.IsSolid(null))
                {
                    break;
                }
                
                Vector3 endPos = transform.position + Vector3.down;
                while (Vector3.Distance(transform.position, endPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * 1.5f * Time.deltaTime);
                    yield return null;
                }
                transform.position = endPos;
                if (GridManager.Instance != null)
                {
                    GridManager.Instance.MoveEntity(this, oldPos, below);
                }
            }
            isMoving = false;
        }
    }
}
