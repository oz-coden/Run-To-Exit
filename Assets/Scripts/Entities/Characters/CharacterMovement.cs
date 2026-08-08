using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public class CharacterMovement : MonoBehaviour
    {
        private float visualYOffset = 0f;

        public void InitializeOffset()
        {
            visualYOffset = transform.position.y - Mathf.Floor(transform.position.y);
        }

        public IEnumerator MoveToRoutine(Vector2Int targetGridPos, float speed)
        {
            Vector3 endPos = new Vector3(targetGridPos.x, targetGridPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, speed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
        }

        public IEnumerator JumpToRoutine(Vector2Int targetGridPos, float height, float speed)
        {
            Vector3 startPos = transform.position;
            Vector3 endPos = new Vector3(targetGridPos.x, targetGridPos.y + visualYOffset, 0);
            
            float progress = 0f;
            float totalDistance = Vector3.Distance(startPos, endPos);
            float duration = totalDistance / speed;

            while (progress < 1f)
            {
                progress += Time.deltaTime / duration;
                Vector3 currentPos = Vector3.Lerp(startPos, endPos, progress);
                currentPos.y += Mathf.Sin(progress * Mathf.PI) * height; // 放物線
                transform.position = currentPos;
                yield return null;
            }
            transform.position = endPos;
        }
    }
}
