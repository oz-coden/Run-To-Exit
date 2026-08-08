using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public class MovableBox : MonoBehaviour
    {
        public int RequiredPower = 1; // 1: 通常箱(青年も押せる), 2: 重い箱(大人のみ)
        public float MoveSpeed = 5f;
        private bool isMoving = false;

        public Vector2Int GridPosition => new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));

        public bool CanMoveTo(Vector2Int targetPos)
        {
            Collider2D hit = GridManager.Instance.GetObjectAt(targetPos);
            if (hit != null && hit.gameObject != this.gameObject)
            {
                // 壁や他の箱など何かがあれば進めない
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
            Vector3 endPos = new Vector3(targetPos.x, targetPos.y, 0);
            
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            isMoving = false;

            CheckFall();
        }

        private void CheckFall()
        {
            Vector2Int below = GridPosition + Vector2Int.down;
            Collider2D hit = GridManager.Instance.GetObjectAt(below);
            if (hit == null || hit.gameObject == gameObject)
            {
                StartCoroutine(FallRoutine());
            }
        }

        private IEnumerator FallRoutine()
        {
            isMoving = true;
            while (true)
            {
                Vector2Int below = GridPosition + Vector2Int.down;
                Collider2D hit = GridManager.Instance.GetObjectAt(below);
                
                if (hit != null && hit.gameObject != gameObject)
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
            }
            isMoving = false;
        }
    }
}
